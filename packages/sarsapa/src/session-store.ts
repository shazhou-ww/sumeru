import {
	appendFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { AdapterInitConfig } from "@sumeru/adapter-core";
import type { ModelConfig } from "@sumeru/core";
import type { LlmMessage } from "./types.js";

export const DEFAULT_SESSION_PATH = join(
	homedir(),
	".sarsapa",
	"session.jsonl",
);

type InitLine = {
	type: "init";
	system: string;
	model: ModelConfig;
};

export type StoredSession = {
	system: string;
	model: ModelConfig;
	turns: Array<LlmMessage>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function parseMessageLine(line: string): LlmMessage | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null;
	}
	if (!isRecord(parsed)) return null;
	if (
		parsed.role !== "user" &&
		parsed.role !== "assistant" &&
		parsed.role !== "tool"
	) {
		return null;
	}
	if (typeof parsed.content !== "string") return null;
	const toolCalls = parsed.toolCalls;
	if (toolCalls !== null && !Array.isArray(toolCalls)) return null;
	const toolCallId = parsed.toolCallId;
	if (toolCallId !== null && typeof toolCallId !== "string") return null;
	return {
		role: parsed.role,
		content: parsed.content,
		toolCalls: toolCalls as LlmMessage["toolCalls"],
		toolCallId: toolCallId as string | null,
	};
}

function parseInitLine(line: string): InitLine | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null;
	}
	if (!isRecord(parsed) || parsed.type !== "init") return null;
	if (typeof parsed.system !== "string") return null;
	if (!isRecord(parsed.model) || typeof parsed.model.name !== "string") {
		return null;
	}
	return {
		type: "init",
		system: parsed.system,
		model: parsed.model as ModelConfig,
	};
}

export function createSessionStore(sessionPath: string = DEFAULT_SESSION_PATH) {
	function exists(): boolean {
		return existsSync(sessionPath);
	}

	function writeInit(system: string, config: AdapterInitConfig): void {
		mkdirSync(dirname(sessionPath), { recursive: true });
		const line: InitLine = { type: "init", system, model: config.model };
		writeFileSync(sessionPath, `${JSON.stringify(line)}\n`, "utf8");
	}

	function appendMessage(message: LlmMessage): void {
		appendFileSync(sessionPath, `${JSON.stringify(message)}\n`, "utf8");
	}

	function load(): StoredSession | null {
		if (!existsSync(sessionPath)) return null;
		const content = readFileSync(sessionPath, "utf8");
		const lines = content.split("\n").filter((line) => line.trim() !== "");
		if (lines.length === 0) return null;

		let system: string | null = null;
		let model: ModelConfig | null = null;
		const turns: Array<LlmMessage> = [];

		for (const line of lines) {
			const initLine = parseInitLine(line);
			if (initLine !== null) {
				system = initLine.system;
				model = initLine.model;
				continue;
			}
			const message = parseMessageLine(line);
			if (message !== null) {
				turns.push(message);
			}
		}

		if (system === null || model === null) return null;
		return { system, model, turns };
	}

	return { exists, writeInit, appendMessage, load };
}
