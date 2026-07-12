import { handleControlFrame, isControlFrameType } from "./control-frames.js";
import type { HarnessConfig } from "./harness-types.js";
import type {
	AdapterEntryOptions,
	AdapterHandleYield,
	AdapterImpl,
	AdapterInboxMessage,
	AdapterInitConfig,
	OutboundFrame,
	SuspendValue,
} from "./types.js";

const DEFAULT_SEND_TIMEOUT_MS = 7_200_000;

export type SessionLoopOptions = AdapterEntryOptions & {
	harness: HarnessConfig;
};

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

function createLineReader(stdin: NodeJS.ReadableStream): {
	nextLine(): Promise<string | null>;
	dispose(): void;
	wake(): void;
} {
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

	return {
		async nextLine(): Promise<string | null> {
			while (true) {
				if (lineQueue.length > 0) {
					return lineQueue.shift() as string;
				}
				if (streamEnded) {
					return null;
				}
				await new Promise<void>((resolve) => {
					wakeup = resolve;
				});
			}
		},
		dispose(): void {
			stdin.removeListener("data", onData);
			stdin.removeListener("end", onEnd);
		},
		wake,
	};
}

export async function runSessionLoop(
	options: SessionLoopOptions,
): Promise<void> {
	const {
		harness,
		impl,
		stdin,
		stdout,
		onSigterm,
		sendTimeoutMs = null,
	} = options;
	const handleTimeoutMs = sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;

	let initialized = false;
	let stopRequested = false;

	const write = (frame: OutboundFrame): void => {
		stdout.write(`${JSON.stringify(frame)}\n`);
	};

	const reader = createLineReader(stdin);

	const disposeSigterm = onSigterm(() => {
		stopRequested = true;
		reader.wake();
	});

	if (impl.resume !== undefined) {
		try {
			const resumed = await impl.resume();
			if (resumed) {
				initialized = true;
				write({ type: "ready", value: {} });
			}
		} catch (err) {
			write({
				type: "error",
				value: { code: "resume_error", message: errorMessage(err) },
			});
			disposeSigterm();
			reader.dispose();
			return;
		}
	}

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

		if (isControlFrameType(frame.type)) {
			try {
				await handleControlFrame(harness, frame);
			} catch (err) {
				write({
					type: "error",
					value: {
						code: "control_frame_error",
						message: errorMessage(err),
					},
				});
				return;
			}
			write({ type: "ready", value: {} });
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
			if (stopRequested) break;
			const line = await reader.nextLine();
			if (line === null) break;
			if (line.trim() === "") continue;
			const result = await processLine(line);
			if (result === "exit") break;
		}
	} finally {
		disposeSigterm();
		reader.dispose();
	}
}

export function createSessionLoop(
	impl: AdapterImpl,
	harness: HarnessConfig,
): void {
	void runSessionLoop({
		harness,
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
