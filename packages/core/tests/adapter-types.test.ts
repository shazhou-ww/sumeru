import { describe, expectTypeOf, it } from "vitest";
import type {
	Adapter,
	NativeSessionRef,
	SendEvent,
	SessionConfig,
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
			createSession: async (_config: SessionConfig) => ({
				nativeId: "20260613_000000_deadbe",
				meta: {},
			}),
			async *send(_ref, _content) {
				yield { type: "turn" as const, turn: fakeTurn };
				yield {
					type: "done" as const,
					durationMs: 0,
					tokens: null,
				};
			},
			close: async (_ref) => {
				/* no-op */
			},
			getTurns: async (_ref) => [fakeTurn],
		};

		expectTypeOf(adapter).toEqualTypeOf<Adapter>();
	});

	it("SessionConfig has model and cwd as string | null", () => {
		expectTypeOf<SessionConfig["model"]>().toEqualTypeOf<string | null>();
		expectTypeOf<SessionConfig["cwd"]>().toEqualTypeOf<string | null>();
	});

	it("SendEvent is a discriminated union on type", () => {
		const turnEvt: SendEvent = {
			type: "turn",
			turn: {
				index: 0,
				role: "assistant",
				content: "hi",
				timestamp: "2026-06-13T00:00:00.000Z",
				toolCalls: null,
			},
		};
		const doneEvt: SendEvent = {
			type: "done",
			durationMs: 100,
			tokens: null,
		};
		const errorEvt: SendEvent = {
			type: "error",
			error: new Error("boom"),
		};
		expectTypeOf(turnEvt).toMatchTypeOf<SendEvent>();
		expectTypeOf(doneEvt).toMatchTypeOf<SendEvent>();
		expectTypeOf(errorEvt).toMatchTypeOf<SendEvent>();
	});

	it("SendEvent includes a terminal suspend variant carrying nativeId + elapsedMs", () => {
		const suspendEvt: SendEvent = {
			type: "suspend",
			reason: "timeout",
			nativeId: "abc",
			elapsedMs: 1234,
		};
		expectTypeOf(suspendEvt).toMatchTypeOf<SendEvent>();

		type SuspendEvent = Extract<SendEvent, { type: "suspend" }>;
		expectTypeOf<SuspendEvent["reason"]>().toEqualTypeOf<"timeout">();
		expectTypeOf<SuspendEvent["nativeId"]>().toEqualTypeOf<string>();
		expectTypeOf<SuspendEvent["elapsedMs"]>().toEqualTypeOf<number>();
	});

	it("rejects a suspend event missing nativeId", () => {
		// @ts-expect-error — nativeId is required, non-nullable
		const _bad: SendEvent = {
			type: "suspend",
			reason: "timeout",
			elapsedMs: 1234,
		};
	});

	it("rejects a suspend event missing elapsedMs", () => {
		// @ts-expect-error — elapsedMs is required, non-nullable
		const _bad: SendEvent = {
			type: "suspend",
			reason: "timeout",
			nativeId: "abc",
		};
	});

	it("rejects a suspend event whose reason is not the literal 'timeout'", () => {
		// @ts-expect-error — reason is the string literal "timeout", not a free string
		const _bad: SendEvent = {
			type: "suspend",
			reason: "cancelled",
			nativeId: "abc",
			elapsedMs: 1234,
		};
	});

	it("SendEvent done tokens uses T | null (not optional)", () => {
		type DoneEvent = Extract<SendEvent, { type: "done" }>;
		expectTypeOf<DoneEvent["tokens"]>().toEqualTypeOf<TokenUsage | null>();
		expectTypeOf<DoneEvent["durationMs"]>().toEqualTypeOf<number>();
	});

	it("NativeSessionRef carries nativeId + open-ended meta", () => {
		expectTypeOf<NativeSessionRef["nativeId"]>().toEqualTypeOf<string>();
		expectTypeOf<NativeSessionRef["meta"]>().toEqualTypeOf<
			Record<string, unknown>
		>();
	});

	it("rejects an Adapter whose send returns Promise<AgentResponse>", () => {
		// @ts-expect-error — send must return AsyncIterable<SendEvent>, not Promise
		const _bad1: Adapter = {
			name: "x",
			createSession: async (_config: SessionConfig) => ({
				nativeId: "x",
				meta: {},
			}),
			send: async (_ref, _content) => ({
				turns: [],
				tokens: null,
				durationMs: 0,
			}),
			close: async () => {},
			getTurns: async () => [],
		};
	});

	it("rejects an Adapter that has a capabilities field but not the new shape", () => {
		// @ts-expect-error — capabilities field is not part of the Adapter type
		const _bad2: Adapter = {
			name: "x",
			capabilities: { resume: false, streaming: false },
			createSession: async (_config: SessionConfig) => ({
				nativeId: "x",
				meta: {},
			}),
			async *send() {
				yield { type: "done" as const, durationMs: 0, tokens: null };
			},
			close: async () => {},
			getTurns: async () => [],
		};
	});
});
