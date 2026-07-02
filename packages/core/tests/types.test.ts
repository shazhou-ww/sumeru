import { describe, expect, it } from "vitest";
import type {
	AssistantTurn,
	CustomProvider,
	ExitBase,
	ExitSignal,
	HostConfig,
	KnownProvider,
	ModelConfig,
	Prototype,
	SessionInfo,
	SessionStatus,
	TokenUsage,
	ToolCall,
	ToolTurn,
	Turn,
} from "../src/index.js";

// Compile-time conformance for the v3 type set (spec-v3 + issue #159).
// Each `const` below is a well-typed literal of a core type; if any signature
// drifts from the spec, `pnpm run typecheck` (tsc --build, strict) fails closed.

describe("@sumeru/core — v3 type set conformance", () => {
	it("constructs a well-typed literal for each core type", () => {
		const tokenUsage: TokenUsage = { input: 100, output: 200, cached: 50 };

		const knownProvider: KnownProvider = "anthropic";
		const customProvider: CustomProvider = {
			name: "corp-llm",
			endpoint: "https://llm.internal.corp/v1",
			apiType: "openai",
		};
		const modelConfig: ModelConfig = {
			provider: knownProvider,
			name: "claude-sonnet-4",
			apiKey: null,
		};
		const modelWithCustom: ModelConfig = {
			provider: customProvider,
			name: "deepseek-v3",
			apiKey: "sk-internal",
		};

		const prototype: Prototype = {
			name: "software-engineer",
			persona: "default",
			model: "anthropic:claude-sonnet-4",
			adapter: "claude-code",
			extensions: null,
			defaults: {
				maxTurns: 40,
				timeout: 7_200_000,
				resources: { cpu: 2, memory: "4G" },
			},
		};

		const sessionStatus: SessionStatus = "running";
		const exitBase: ExitBase = {
			elapsedMs: 1200,
			turnCount: 3,
			tokenUsage,
		};
		const exitComplete: ExitSignal = {
			...exitBase,
			type: "complete",
			message: "Done.",
		};
		const exitTimeout: ExitSignal = {
			...exitBase,
			type: "timeout",
		};
		const sessionInfo: SessionInfo = {
			id: "ses_01JXYZ",
			prototype: prototype.name,
			model: modelConfig,
			image: "sumeru/typescript:node22",
			project: "united-workforce",
			task: "Fix login button",
			status: sessionStatus,
			exit: null,
			createdAt: "2026-06-29T00:00:00.000Z",
		};

		const toolCall: ToolCall = {
			id: "call_1",
			name: "bash",
			arguments: { cmd: "ls" },
		};
		const assistantTurn: AssistantTurn = {
			id: 0,
			role: "assistant",
			content: "Running ls.",
			toolCalls: [toolCall],
			tokenUsage,
			durationMs: 500,
			timestamp: "2026-06-29T00:00:00.000Z",
		};
		const toolTurn: ToolTurn = {
			id: 1,
			role: "tool",
			callId: "call_1",
			name: "bash",
			result: "README.md\n",
			durationMs: 120,
			timestamp: "2026-06-29T00:00:01.000Z",
		};
		const turn: Turn = assistantTurn;

		const hostConfig: HostConfig = {
			name: "neko-host",
			maxRunning: 3,
			workspaceRoot: "/home/azureuser/repos",
			envFile: "~/.config/sumeru/.env",
			defaults: {
				timeout: 7_200_000,
				maxTurns: 40,
				resources: { cpu: 2, memory: "4G" },
			},
		};

		expect(tokenUsage.cached).toBe(50);
		expect(knownProvider).toBe("anthropic");
		expect(customProvider.apiType).toBe("openai");
		expect(modelConfig.apiKey).toBeNull();
		expect(modelWithCustom.provider).toEqual(customProvider);
		expect(prototype.adapter).toBe("claude-code");
		expect(sessionStatus).toBe("running");
		expect(exitComplete.type).toBe("complete");
		expect(exitTimeout.type).toBe("timeout");
		expect(sessionInfo.exit).toBeNull();
		expect(toolCall.name).toBe("bash");
		expect(assistantTurn.role).toBe("assistant");
		expect(toolTurn.callId).toBe("call_1");
		expect(turn.role).toBe("assistant");
		expect(hostConfig.maxRunning).toBe(3);
	});

	it("narrows ExitSignal on `type` and is exhaustive", () => {
		const signals: Array<ExitSignal> = [
			{
				elapsedMs: 1,
				turnCount: 1,
				tokenUsage: { input: 1, output: 2, cached: 0 },
				type: "complete",
				message: "ok",
			},
			{
				elapsedMs: 1,
				turnCount: 1,
				tokenUsage: { input: 1, output: 2, cached: 0 },
				type: "failed",
				message: "no",
			},
			{
				elapsedMs: 1,
				turnCount: 1,
				tokenUsage: { input: 1, output: 2, cached: 0 },
				type: "needsInput",
				message: "need token",
			},
			{
				elapsedMs: 1,
				turnCount: 1,
				tokenUsage: { input: 0, output: 0, cached: 0 },
				type: "timeout",
			},
			{
				elapsedMs: 1,
				turnCount: 1,
				tokenUsage: { input: 0, output: 0, cached: 0 },
				type: "stopped",
			},
			{
				elapsedMs: 1,
				turnCount: 1,
				tokenUsage: { input: 0, output: 0, cached: 0 },
				type: "exhausted",
			},
		];

		expect(signals.map(describeExit)).toEqual([
			"complete:ok",
			"failed:no",
			"needsInput:need token",
			"timeout",
			"stopped",
			"exhausted",
		]);
	});

	it("narrows Turn on `role` and is exhaustive", () => {
		const assistant: Turn = {
			id: 0,
			role: "assistant",
			content: "hi",
			toolCalls: [],
			tokenUsage: { input: 1, output: 2, cached: 0 },
			durationMs: 10,
			timestamp: "2026-06-29T00:00:00.000Z",
		};
		const tool: Turn = {
			id: 1,
			role: "tool",
			callId: "c1",
			name: "bash",
			result: "ok",
			durationMs: 5,
			timestamp: "2026-06-29T00:00:01.000Z",
		};

		expect(describeTurn(assistant)).toBe("assistant#0");
		expect(describeTurn(tool)).toBe("tool:bash");
	});
});

function describeExit(exit: ExitSignal): string {
	switch (exit.type) {
		case "complete":
		case "failed":
		case "needsInput":
			return `${exit.type}:${exit.message}`;
		case "timeout":
		case "stopped":
		case "exhausted":
			return exit.type;
		default: {
			const _never: never = exit;
			return _never;
		}
	}
}

function describeTurn(turn: Turn): string {
	switch (turn.role) {
		case "assistant":
			return `assistant#${turn.id}`;
		case "tool":
			return `tool:${turn.name}`;
		default: {
			const _never: never = turn;
			return _never;
		}
	}
}
