import type { LlmToolCall } from "../types.js";

// OpenAI tool_call shape: { id, type:"function", function:{ name, arguments } }
function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null;
}

export function parseToolCalls(raw: unknown): Array<LlmToolCall> | null {
	if (!Array.isArray(raw) || raw.length === 0) return null;
	const out: Array<LlmToolCall> = [];
	for (const item of raw) {
		if (!isRecord(item)) continue;
		const fn = item.function;
		if (!isRecord(fn)) continue;
		const id = typeof item.id === "string" ? item.id : `call_${out.length}`;
		const name = typeof fn.name === "string" ? fn.name : "";
		const args = typeof fn.arguments === "string" ? fn.arguments : "{}";
		if (name.length === 0) continue;
		out.push({ id, name, arguments: args });
	}
	return out.length > 0 ? out : null;
}
