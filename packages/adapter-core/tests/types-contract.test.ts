// Spec: adapter-core-types-contract.md
// Compile-time + minimal runtime conformance for the exported contract.

import type {
	DoneValue,
	InboxMessage,
	ModelConfig,
	TurnValue,
} from "@sumeru/core";
import { describe, expect, expectTypeOf, it } from "vitest";
import type {
	AdapterHandleYield,
	AdapterImpl,
	AdapterInboxMessage,
	AdapterInitConfig,
	InboundFrame,
	OutboundFrame,
	SkillContent,
} from "../src/index.js";
import { createAdapterEntry } from "../src/index.js";

describe("@sumeru/adapter-core — types contract", () => {
	it("exports createAdapterEntry as a named function (impl) => void", () => {
		expect(typeof createAdapterEntry).toBe("function");
		expectTypeOf(createAdapterEntry).toEqualTypeOf<
			(impl: AdapterImpl) => void
		>();
	});

	it("AdapterImpl.handle is AsyncGenerator<AdapterHandleYield, DoneValue>", () => {
		const impl: AdapterImpl = {
			async init() {},
			// biome-ignore lint/correctness/useYield: type-shape conformance only
			async *handle(message: InboxMessage) {
				void message;
				return { summary: null, tokenUsage: null };
			},
		};
		expectTypeOf(impl.handle).returns.toEqualTypeOf<
			AsyncGenerator<AdapterHandleYield, DoneValue>
		>();
		expect(typeof impl.init).toBe("function");
	});

	it("AdapterInitConfig reuses ModelConfig from @sumeru/core", () => {
		const model: ModelConfig = {
			provider: "anthropic",
			name: "claude-sonnet-4",
			apiKeyEnv: "ANTHROPIC_API_KEY",
			contextWindow: 200000,
		};
		const config: AdapterInitConfig = {
			instructions: "hi",
			skills: [{ name: "tdd", content: "# TDD" }],
			model,
		};
		expectTypeOf<AdapterInitConfig["model"]>().toEqualTypeOf<ModelConfig>();
		expect(config.model.provider).toBe("anthropic");
	});

	it("SkillContent is { name; content }", () => {
		const skill: SkillContent = { name: "a", content: "b" };
		expectTypeOf(skill).toEqualTypeOf<{ name: string; content: string }>();
	});

	it("InboundFrame message carries resumeNativeId", () => {
		const frame: InboundFrame = {
			type: "message",
			value: {
				messageId: "m",
				content: "c",
				project: null,
				resumeNativeId: "native-1",
			},
		};
		if (frame.type === "message") {
			expectTypeOf(frame.value).toEqualTypeOf<AdapterInboxMessage>();
		}
	});

	it("OutboundFrame narrows ready to empty object and reuses core payloads", () => {
		const ready: OutboundFrame = { type: "ready", value: {} };
		expect(ready.value).toEqual({});
		const turn: OutboundFrame = {
			type: "turn",
			value: {
				index: 0,
				role: "assistant",
				content: "x",
				timestamp: "t",
				toolCalls: null,
				tokens: null,
			},
		};
		if (turn.type === "turn") {
			expectTypeOf(turn.value).toEqualTypeOf<TurnValue>();
		}
	});
});
