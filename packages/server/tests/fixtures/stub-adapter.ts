/**
 * In-memory stub adapter used by server-level tests that just need a working
 * Adapter implementation. The stub does not shell out — it produces synthetic
 * turns so the SSE pipeline can be exercised without a real Hermes binary.
 */

import type {
	Adapter,
	AdapterCapabilities,
	AgentResponse,
	NativeSessionRef,
	Turn,
} from "@sumeru/core";

export type StubAdapterOptions = {
	name: string;
	capabilities: AdapterCapabilities;
	/**
	 * Per-call response fabricator. Receives `(content)` and returns the turns
	 * that should be emitted for that send. If null, a default echo response
	 * is produced.
	 */
	respond:
		| ((content: string, ref: NativeSessionRef) => Promise<AgentResponse>)
		| null;
	/** Per-call delay before the response resolves. */
	sendDelayMs: number;
	/** When true, every send rejects with the configured error message. */
	failOnSend: string | null;
	/** When true, createSession rejects with the configured error message. */
	failOnCreate: string | null;
};

export type StubAdapterControl = {
	adapter: Adapter;
	closed: Set<string>;
	created: NativeSessionRef[];
	/** Update the response factory at runtime (used by some tests). */
	setResponse: (
		fn: (content: string, ref: NativeSessionRef) => Promise<AgentResponse>,
	) => void;
};

let counter = 0;

export function makeStubAdapter(
	override: Partial<StubAdapterOptions> = {},
): StubAdapterControl {
	const opts: StubAdapterOptions = {
		name: override.name ?? "stub",
		capabilities: override.capabilities ?? {
			resume: true,
			streaming: false,
		},
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
		capabilities: opts.capabilities,
		async createSession(): Promise<NativeSessionRef> {
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
		async send(ref: NativeSessionRef, content: string): Promise<AgentResponse> {
			if (opts.failOnSend !== null) {
				if (opts.sendDelayMs > 0) {
					await delay(opts.sendDelayMs);
				}
				throw new Error(opts.failOnSend);
			}
			if (opts.sendDelayMs > 0) {
				await delay(opts.sendDelayMs);
			}
			if (respond !== null) {
				return respond(content, ref);
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
			return {
				turns,
				tokens: { input: 1, output: 2 },
				durationMs: opts.sendDelayMs,
			};
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
