/**
 * In-memory stub adapter used by server-level tests that just need a working
 * Adapter implementation. The stub does not shell out — it produces synthetic
 * turns so the SSE pipeline can be exercised without a real Hermes binary.
 */

import type {
	Adapter,
	NativeSessionRef,
	SendEvent,
	SessionConfig,
	Turn,
} from "@sumeru/core";

export type StubAdapterOptions = {
	name: string;
	/**
	 * Per-call response fabricator. Receives `(content, ref)` and returns the
	 * SendEvents that should be yielded. If null, a default echo response is
	 * produced.
	 */
	respond:
		| ((content: string, ref: NativeSessionRef) => AsyncIterable<SendEvent>)
		| null;
	/** Per-call delay before each event is yielded. */
	sendDelayMs: number;
	/** When non-null, every send yields an error event with this message. */
	failOnSend: string | null;
	/** When non-null, createSession rejects with this error message. */
	failOnCreate: string | null;
};

export type StubAdapterControl = {
	adapter: Adapter;
	closed: Set<string>;
	created: NativeSessionRef[];
	/** Update the response factory at runtime (used by some tests). */
	setResponse: (
		fn: (content: string, ref: NativeSessionRef) => AsyncIterable<SendEvent>,
	) => void;
};

let counter = 0;

export function makeStubAdapter(
	override: Partial<StubAdapterOptions> = {},
): StubAdapterControl {
	const opts: StubAdapterOptions = {
		name: override.name ?? "stub",
		respond: override.respond ?? null,
		sendDelayMs: override.sendDelayMs ?? 0,
		failOnSend: override.failOnSend ?? null,
		failOnCreate: override.failOnCreate ?? null,
	};
	const closed = new Set<string>();
	const created: NativeSessionRef[] = [];

	let respond = opts.respond;

	const adapter: Adapter = {
		name: opts.name,
		async createSession(_config: SessionConfig): Promise<NativeSessionRef> {
			if (opts.failOnCreate !== null) {
				throw new Error(opts.failOnCreate);
			}
			counter += 1;
			const ref: NativeSessionRef = {
				nativeId: `stub_${counter}_${Date.now().toString(36)}`,
				meta: {},
			};
			created.push(ref);
			return ref;
		},
		send(ref: NativeSessionRef, content: string): AsyncIterable<SendEvent> {
			async function* generate(): AsyncGenerator<SendEvent> {
				if (opts.failOnSend !== null) {
					if (opts.sendDelayMs > 0) {
						await delay(opts.sendDelayMs);
					}
					yield { type: "error", error: new Error(opts.failOnSend) };
					return;
				}
				if (opts.sendDelayMs > 0) {
					await delay(opts.sendDelayMs);
				}
				if (respond !== null) {
					yield* respond(content, ref);
					return;
				}
				const turns: Turn[] = [
					{
						index: 1,
						role: "assistant",
						content: `echo: ${content}`,
						toolCalls: null,
						tokens: null,
						timestamp: new Date().toISOString(),
					},
				];
				for (const turn of turns) {
					yield { type: "turn", turn };
				}
				yield {
					type: "done",
					durationMs: opts.sendDelayMs,
					tokens: { input: 1, output: 2 },
				};
			}
			return generate();
		},
		async close(ref: NativeSessionRef): Promise<void> {
			closed.add(ref.nativeId);
		},
		async getTurns(): Promise<Turn[]> {
			return [];
		},
	};

	return {
		adapter,
		closed,
		created,
		setResponse(fn) {
			respond = fn;
		},
	};
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
