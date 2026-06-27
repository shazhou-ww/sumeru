import { describe, expect, it } from "vitest";
import type {
	CustomProvider,
	DoneValue,
	ErrorValue,
	HostConfig,
	InboxMessage,
	InstanceId,
	InstanceInfo,
	InstanceStatus,
	KnownProvider,
	Manifest,
	MasterConfig,
	ModelConfig,
	OutboxFrame,
	ResourceLimits,
	SuspendValue,
	TokenUsage,
	ToolCall,
	TurnValue,
} from "../src/index.js";

// Compile-time conformance for the M1 minimal type set (wiki §1).
// Each `const` below is a well-typed literal of a core type; if any signature
// drifts from the wiki, `pnpm run typecheck` (tsc --build, strict) fails closed.

describe("@sumeru/core — minimal type set conformance", () => {
	it("constructs a well-typed literal for each core type", () => {
		const tokenUsage: TokenUsage = { input: 100, output: 200 };

		const knownProvider: KnownProvider = "anthropic";
		const customProvider: CustomProvider = {
			baseUrl: "https://llm.example.com",
			apiType: "openai",
		};
		const modelConfig: ModelConfig = {
			provider: knownProvider,
			name: "claude-sonnet",
			apiKeyEnv: "ANTHROPIC_API_KEY",
			contextWindow: 200000,
		};
		const manifest: Manifest = {
			name: "demo-agent",
			model: modelConfig,
			instructions: "be helpful",
			skills: ["search"],
		};

		const instanceId: InstanceId = "inst_0";
		const instanceStatus: InstanceStatus = "running";
		const instanceInfo: InstanceInfo = {
			id: instanceId,
			prototype: null,
			status: instanceStatus,
			createdAt: "2026-06-27T00:00:00.000Z",
			projects: ["alpha"],
		};

		const inbox: InboxMessage = {
			messageId: "msg_1",
			content: "hello",
			project: null,
		};

		const toolCall: ToolCall = {
			tool: "bash",
			input: { cmd: "ls" },
			output: null,
			durationMs: null,
			exitCode: null,
		};
		const turnValue: TurnValue = {
			index: 0,
			role: "assistant",
			content: "hi",
			timestamp: "2026-06-27T00:00:00.000Z",
			toolCalls: [toolCall],
			tokens: tokenUsage,
		};
		const doneValue: DoneValue = {
			summary: null,
			tokenUsage,
		};
		const suspendValue: SuspendValue = {
			reason: "timeout",
			elapsedMs: 1000,
		};
		const errorValue: ErrorValue = {
			code: "E_FAIL",
			message: "boom",
		};

		const masterConfig: MasterConfig = {
			adapter: "claude-code",
			config: {},
		};
		const resourceLimits: ResourceLimits = {
			maxMemory: "2G",
			maxCpus: 2,
			maxInstances: 8,
		};
		const hostConfig: HostConfig = {
			name: "node-1",
			master: masterConfig,
			resources: resourceLimits,
		};

		// Touch each literal at runtime so the suite exercises every type.
		expect(tokenUsage.input).toBe(100);
		expect(knownProvider).toBe("anthropic");
		expect(customProvider.apiType).toBe("openai");
		expect(modelConfig.contextWindow).toBe(200000);
		expect(manifest.skills).toEqual(["search"]);
		expect(instanceId).toBe("inst_0");
		expect(instanceStatus).toBe("running");
		expect(instanceInfo.prototype).toBeNull();
		expect(inbox.project).toBeNull();
		expect(toolCall.exitCode).toBeNull();
		expect(turnValue.role).toBe("assistant");
		expect(doneValue.summary).toBeNull();
		expect(suspendValue.reason).toBe("timeout");
		expect(errorValue.code).toBe("E_FAIL");
		expect(masterConfig.adapter).toBe("claude-code");
		expect(resourceLimits.maxCpus).toBe(2);
		expect(hostConfig.name).toBe("node-1");
	});

	it("narrows OutboxFrame on `type` and is exhaustive over turn|done|suspend|error", () => {
		const turnFrame: OutboxFrame = {
			type: "turn",
			value: {
				index: 1,
				role: "user",
				content: "hi",
				timestamp: "2026-06-27T00:00:00.000Z",
				toolCalls: null,
				tokens: null,
			},
		};
		const doneFrame: OutboxFrame = {
			type: "done",
			value: { summary: "ok", tokenUsage: null },
		};
		const suspendFrame: OutboxFrame = {
			type: "suspend",
			value: { reason: "inputRequired", elapsedMs: 5 },
		};
		const errorFrame: OutboxFrame = {
			type: "error",
			value: { code: "E_BOOM", message: "kaboom" },
		};

		// `type` tag round-trips for each variant.
		expect(turnFrame.type).toBe("turn");
		expect(doneFrame.type).toBe("done");
		expect(suspendFrame.type).toBe("suspend");
		expect(errorFrame.type).toBe("error");

		// Discrimination narrows `value` to the matching payload (no cast).
		expect(describeFrame(turnFrame)).toBe("turn#1");
		expect(describeFrame(doneFrame)).toBe("ok");
		expect(describeFrame(suspendFrame)).toBe("inputRequired");
		expect(describeFrame(errorFrame)).toBe("E_BOOM");
	});
});

// Exhaustive narrowing: the `default` branch's `never` assignment compiles only
// while OutboxFrame is closed at exactly turn|done|suspend|error. Adding or
// renaming a member without updating this consumer breaks `tsc`.
function describeFrame(frame: OutboxFrame): string {
	switch (frame.type) {
		case "turn": {
			const v: TurnValue = frame.value;
			return `turn#${v.index}`;
		}
		case "done": {
			const v: DoneValue = frame.value;
			return v.summary ?? "done";
		}
		case "suspend": {
			const v: SuspendValue = frame.value;
			return v.reason;
		}
		case "error": {
			const v: ErrorValue = frame.value;
			return v.code;
		}
		default: {
			const _never: never = frame;
			return _never;
		}
	}
}
