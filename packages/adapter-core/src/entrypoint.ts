// @sumeru/adapter-core — cli-kit NDJSON entrypoint.
// Reads init/message frames from stdin (NDJSON), drives an AdapterImpl, and
// writes ready/turn/done/error frames to stdout. Authoritative source:
// package-design wiki §4 "@sumeru/adapter-core — Adapter 公共框架".

import type { InboxMessage } from "@sumeru/core";
import type {
	AdapterEntryOptions,
	AdapterImpl,
	AdapterInitConfig,
	OutboundFrame,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

// Serial NDJSON entrypoint loop over an injectable stdin/stdout seam.
// Resolves (graceful shutdown) on stdin EOF or SIGTERM; never rejects for
// protocol/handler failures — those surface as a terminal `error` frame.
export async function runAdapterEntry(
	options: AdapterEntryOptions,
): Promise<void> {
	const { impl, stdin, stdout, onSigterm } = options;

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

	const handleMessage = async (message: InboxMessage): Promise<void> => {
		const generator = impl.handle(message);
		try {
			let step = await generator.next();
			while (step.done !== true) {
				write({ type: "turn", value: step.value });
				step = await generator.next();
			}
			write({ type: "done", value: step.value });
		} catch (err) {
			write({
				type: "error",
				value: { code: "handler_error", message: errorMessage(err) },
			});
		}
	};

	const processLine = async (line: string): Promise<void> => {
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
			await handleMessage(frame.value as InboxMessage);
			return;
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
			await processLine(line);
		}
	} finally {
		disposeSigterm();
		stdin.removeListener("data", onData);
		stdin.removeListener("end", onEnd);
	}
}

// Public entrypoint: wires an AdapterImpl to the real process stdio + SIGTERM.
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
	}).catch((err: unknown) => {
		process.stdout.write(
			`${JSON.stringify({
				type: "error",
				value: { code: "fatal_error", message: errorMessage(err) },
			})}\n`,
		);
		process.exitCode = 1;
	});
}
