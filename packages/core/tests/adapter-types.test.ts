import { describe, expectTypeOf, it } from "vitest";
import type {
	Adapter,
	AdapterCapabilities,
	AgentResponse,
	NativeSessionRef,
	TokenUsage,
	Turn,
} from "../src/index.js";

describe("@sumeru/core — Adapter type surface", () => {
	it("Adapter is constructible from object literal satisfying the contract", () => {
		const fakeTurn: Turn = {
			index: 0,
			role: "user",
			content: "hi",
			timestamp: "2026-06-13T00:00:00.000Z",
			toolCalls: null,
		};

		const adapter: Adapter = {
			name: "hermes",
			capabilities: { resume: true, streaming: false },
			createSession: async (_config) => ({
				nativeId: "20260613_000000_deadbe",
				meta: {},
			}),
			send: async (_ref, _content) => ({
				turns: [fakeTurn],
				tokens: null,
				durationMs: 0,
			}),
			close: async (_ref) => {
				/* no-op */
			},
			getTurns: async (_ref) => [fakeTurn],
		};

		expectTypeOf(adapter).toEqualTypeOf<Adapter>();
	});

	it("capability fields are bare booleans (no optional, no null)", () => {
		expectTypeOf<AdapterCapabilities["resume"]>().toEqualTypeOf<boolean>();
		expectTypeOf<AdapterCapabilities["streaming"]>().toEqualTypeOf<boolean>();
	});

	it("AgentResponse uses T | null for absent tokens (not optional)", () => {
		expectTypeOf<AgentResponse["tokens"]>().toEqualTypeOf<TokenUsage | null>();
		expectTypeOf<AgentResponse["durationMs"]>().toEqualTypeOf<number>();
	});

	it("NativeSessionRef carries nativeId + open-ended meta", () => {
		expectTypeOf<NativeSessionRef["nativeId"]>().toEqualTypeOf<string>();
		expectTypeOf<NativeSessionRef["meta"]>().toEqualTypeOf<
			Record<string, unknown>
		>();
	});

	it("rejects shapes that omit required fields", () => {
		// @ts-expect-error — missing capabilities
		const _bad1: Adapter = {
			name: "x",
			createSession: async () => ({ nativeId: "x", meta: {} }),
			send: async () => ({ turns: [], tokens: null, durationMs: 0 }),
			close: async () => {},
			getTurns: async () => [],
		};

		// @ts-expect-error — non-Promise return on send
		const _bad2: Adapter = {
			name: "x",
			capabilities: { resume: false, streaming: false },
			createSession: async () => ({ nativeId: "x", meta: {} }),
			send: () => ({ turns: [], tokens: null, durationMs: 0 }),
			close: async () => {},
			getTurns: async () => [],
		};
	});
});
