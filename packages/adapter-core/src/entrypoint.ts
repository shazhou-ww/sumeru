// @sumeru/adapter-core — cli-kit NDJSON entrypoint.
// Reads init/message frames from stdin (NDJSON), drives an AdapterImpl, and
// writes ready/turn/done/suspend/error frames to stdout. Authoritative source:
// package-design wiki §4 "@sumeru/adapter-core — Adapter 公共框架".

import type { SuspendValue } from "@sumeru/core";
import type {
	AdapterEntryOptions,
	AdapterHandleYield,
	AdapterImpl,
	AdapterInboxMessage,
	AdapterInitConfig,
	OutboundFrame,
} from "./types.js";

const DEFAULT_SEND_TIMEOUT_MS = 7_200_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function parseAdapterInboxMessage(value: unknown): AdapterInboxMessage | null {
	if (!isRecord(value)) return null;
	if (typeof value.messageId !== "string") return null;
	if (typeof value.content !== "string") return null;
	const project = value.project;
	if (project !== null && typeof project !== "string") return null;
	return {
		messageId: value.messageId,
		content: value.content,
		project: project as string | null,
	};
}

function resolveNativeId(impl: AdapterImpl): string | null {
	return impl.getNativeId?.() ?? null;
}

function isImplSuspendYield(
	value: AdapterHandleYield,
): value is { type: "suspend"; value: SuspendValue } {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		value.type === "suspend"
	);
}

async function abortGenerator(
	generator: AsyncGenerator<unknown, unknown>,
): Promise<void> {
	try {
		await generator.return(undefined as never);
	} catch {
		// Generator may reject on forced return; timeout suspend is terminal.
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

// Serial NDJSON entrypoint loop over an injectable stdin/stdout seam.
// Resolves (graceful shutdown) on stdin EOF or SIGTERM; never rejects for
// protocol/handler failures — those surface as a terminal `error` frame.
export async function runAdapterEntry(
	options: AdapterEntryOptions,
): Promise<void> {
	const { impl, stdin, stdout, onSigterm, sendTimeoutMs = null } = options;
	const handleTimeoutMs = sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;

	let initialized = false;
	let stopRequested = false;

	const write = (frame: OutboundFrame): void => {
		stdout.write(`${JSON.stringify(frame)}\n`);
	};

	// Line buffering: NDJSON is one JSON value per line; partial trailing
	// content is held until its newline arrives.
	const lineQueue: Array<string> = [];
	let pending = "";
	let streamEnded = false;
	let wakeup: (() => void) | null = null;

	const wake = (): void => {
		if (wakeup !== null) {
			const resume = wakeup;
			wakeup = null;
			resume();
		}
	};

	const onData = (chunk: string | Buffer): void => {
		pending += typeof chunk === "string" ? chunk : chunk.toString("utf8");
		let newlineIdx = pending.indexOf("\n");
		while (newlineIdx >= 0) {
			lineQueue.push(pending.slice(0, newlineIdx));
			pending = pending.slice(newlineIdx + 1);
			newlineIdx = pending.indexOf("\n");
		}
		wake();
	};

	const onEnd = (): void => {
		if (streamEnded) return;
		if (pending.length > 0) {
			lineQueue.push(pending);
			pending = "";
		}
		streamEnded = true;
		wake();
	};

	stdin.setEncoding("utf8");
	stdin.on("data", onData);
	stdin.on("end", onEnd);

	const disposeSigterm = onSigterm(() => {
		// Idempotent: a second SIGTERM only re-sets an already-set flag.
		stopRequested = true;
		wake();
	});

	const handleMessage = async (
		message: AdapterInboxMessage,
	): Promise<"exit" | undefined> => {
		const generator = impl.handle(message);
		const startedAt = Date.now();
		const timeoutPromise = delay(handleTimeoutMs).then(() => ({
			kind: "timeout" as const,
		}));

		try {
			while (true) {
				const raced = await Promise.race([
					generator.next().then((step) => ({ kind: "next" as const, step })),
					timeoutPromise,
				]);

				if (raced.kind === "timeout") {
					write({
						type: "suspend",
						value: {
							reason: "timeout",
							elapsedMs: Date.now() - startedAt,
							nativeId: resolveNativeId(impl),
						},
					});
					void abortGenerator(generator);
					return "exit";
				}

				const step = raced.step;
				if (step.done === true) {
					write({ type: "done", value: step.value });
					return;
				}
				if (isImplSuspendYield(step.value)) {
					write({
						type: "suspend",
						value: {
							...step.value.value,
							nativeId: resolveNativeId(impl),
						},
					});
					return "exit";
				}
				write({ type: "turn", value: step.value });
			}
		} catch (err) {
			write({
				type: "error",
				value: { code: "handler_error", message: errorMessage(err) },
			});
		}
	};

	const processLine = async (line: string): Promise<"exit" | undefined> => {
		let frame: unknown;
		try {
			frame = JSON.parse(line);
		} catch {
			write({
				type: "error",
				value: {
					code: "protocol_error",
					message: `invalid JSON line: ${line}`,
				},
			});
			return;
		}
		if (!isRecord(frame) || typeof frame.type !== "string") {
			write({
				type: "error",
				value: {
					code: "protocol_error",
					message: "frame missing string `type`",
				},
			});
			return;
		}

		if (frame.type === "init") {
			if (initialized) {
				write({
					type: "error",
					value: { code: "protocol_error", message: "duplicate init frame" },
				});
				return;
			}
			try {
				await impl.init(frame.value as AdapterInitConfig);
			} catch (err) {
				// init failed: no `ready`, stay uninitialized.
				write({
					type: "error",
					value: { code: "init_error", message: errorMessage(err) },
				});
				return;
			}
			initialized = true;
			write({ type: "ready", value: {} });
			return;
		}

		if (frame.type === "message") {
			if (!initialized) {
				write({
					type: "error",
					value: {
						code: "init_required",
						message: "received message before init",
					},
				});
				return;
			}
			const message = parseAdapterInboxMessage(frame.value);
			if (message === null) {
				write({
					type: "error",
					value: {
						code: "protocol_error",
						message: "invalid message frame value",
					},
				});
				return;
			}
			return handleMessage(message);
		}

		write({
			type: "error",
			value: {
				code: "protocol_error",
				message: `unknown frame type: ${frame.type}`,
			},
		});
	};

	try {
		while (true) {
			// SIGTERM: stop accepting new work. A message already in-flight has
			// completed (its generator drained to `done`) because processLine is
			// awaited below before we re-check this flag.
			if (stopRequested) break;
			if (lineQueue.length === 0) {
				if (streamEnded) break;
				await new Promise<void>((resolve) => {
					wakeup = resolve;
				});
				continue;
			}
			const line = lineQueue.shift() as string;
			if (line.trim() === "") continue;
			const result = await processLine(line);
			if (result === "exit") break;
		}
	} finally {
		disposeSigterm();
		stdin.removeListener("data", onData);
		stdin.removeListener("end", onEnd);
	}
}

// Public entrypoint: wires an AdapterImpl to the real process stdio + SIGTERM.
// Calls process.exit() on completion — one process = one ReAct loop (#146).
export function createAdapterEntry(impl: AdapterImpl): void {
	void runAdapterEntry({
		impl,
		stdin: process.stdin,
		stdout: process.stdout,
		onSigterm: (handler) => {
			process.on("SIGTERM", handler);
			return () => {
				process.removeListener("SIGTERM", handler);
			};
		},
		sendTimeoutMs: null,
	})
		.then(() => {
			process.exit(0);
		})
		.catch((err: unknown) => {
			process.stdout.write(
				`${JSON.stringify({
					type: "error",
					value: { code: "fatal_error", message: errorMessage(err) },
				})}\n`,
			);
			process.exit(1);
		});
}
