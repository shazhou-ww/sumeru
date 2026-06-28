import type { LlmMessage, LlmToolCall } from "./types.js";

export type Conversation = {
	system: string;
	turns: Array<LlmMessage>;
};

export function createConversation(system: string): Conversation {
	return { system, turns: [] };
}

export function pushUser(conv: Conversation, content: string): void {
	conv.turns.push({ role: "user", content, toolCalls: null, toolCallId: null });
}

export function pushAssistant(
	conv: Conversation,
	content: string,
	toolCalls: Array<LlmToolCall> | null,
): void {
	conv.turns.push({ role: "assistant", content, toolCalls, toolCallId: null });
}

export function pushToolResult(
	conv: Conversation,
	toolCallId: string,
	content: string,
): void {
	conv.turns.push({
		role: "tool",
		content,
		toolCalls: null,
		toolCallId,
	});
}

export function toMessages(conv: Conversation): Array<LlmMessage> {
	const systemMsg: LlmMessage = {
		role: "system",
		content: conv.system,
		toolCalls: null,
		toolCallId: null,
	};
	return [systemMsg, ...conv.turns];
}
