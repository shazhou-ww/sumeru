/**
 * Generator action for the SSE message endpoint.
 *
 * Iterates `adapter.send` events, records each turn to ocas / search / turn
 * list, and yields wire-ready `SseOutEvent` values. The caller is responsible
 * for HTTP-level concerns (headers, heartbeats, buffering, encoding).
 */

import { SchemaValidationError } from "@ocas/core";
import type { Adapter, NativeSessionRef, Turn } from "@sumeru/core";
import type { ActionContext } from "../api-kit/types.js";
import { recordPayload } from "../ocas/index.js";
import type { SessionStore } from "../session/index.js";
import type { ServerConfig } from "../types.js";

/**
 * A single SSE event ready for wire encoding. `event` is the SSE event type
 * (turn, done, suspend, error, heartbeat) and `data` is the JSON-serialized
 * envelope payload.
 */
export type SseOutEvent = {
	event: string;
	data: string;
};

export type MessageActionParams = {
	gatewayName: string;
	sessionId: string;
};

export type MessageActionBody = {
	content: string;
};

export type MessageActionDeps = {
	adapter: Adapter;
	nativeRef: NativeSessionRef;
	sessions: SessionStore;
	config: ServerConfig;
};

export type MessageActionCtx = ActionContext<
	MessageActionParams,
	MessageActionBody
> & {
	deps: MessageActionDeps;
};

export async function* messageAction(
	ctx: MessageActionCtx,
): AsyncGenerator<SseOutEvent> {
	const { params, body, deps } = ctx;
	const { adapter, nativeRef, sessions, config } = deps;
	const { gatewayName, sessionId } = params;

	let turnCount = 0;
	try {
		for await (const event of adapter.send(nativeRef, body.content)) {
			if (event.type === "turn") {
				const turn = event.turn;
				const payload = turnPayload(turn);
				let hash: string;
				try {
					hash = recordPayload(
						config.ocas.store,
						config.ocas.turnSchemaHash,
						payload,
					);
				} catch (err) {
					const cause = err instanceof Error ? err.message : String(err);
					const reason =
						err instanceof SchemaValidationError
							? "adapter_returned_invalid_turn"
							: "ocas_write_failed";
					yield {
						event: "error",
						data: JSON.stringify({
							type: "@sumeru/error",
							value: { error: reason, message: truncate(cause, 500) },
						}),
					};
					break;
				}
				try {
					config.ocas.searchIndex.indexTurn({
						turnHash: hash,
						sessionId,
						gateway: gatewayName,
						turnIndex: turn.index,
						role: turn.role,
						content: turn.content,
						createdAt: turn.timestamp,
					});
				} catch (err) {
					const cause = err instanceof Error ? err.message : String(err);
					yield {
						event: "error",
						data: JSON.stringify({
							type: "@sumeru/error",
							value: {
								error: "search_index_failed",
								message: `Failed to update search index: ${truncate(cause, 500)}`,
							},
						}),
					};
					break;
				}
				try {
					sessions.appendTurnHash(gatewayName, sessionId, hash);
				} catch (err) {
					const cause = err instanceof Error ? err.message : String(err);
					yield {
						event: "error",
						data: JSON.stringify({
							type: "@sumeru/error",
							value: {
								error: "turn_persist_failed",
								message: `Failed to persist turn list: ${truncate(cause, 500)}`,
							},
						}),
					};
					break;
				}
				const wireTurn: Turn = { ...turn, hash };
				yield {
					event: "turn",
					data: JSON.stringify({ type: "@sumeru/turn", value: wireTurn }),
				};
				turnCount += 1;
			} else if (event.type === "done") {
				const summary = {
					turnCount,
					tokens:
						event.tokens === null
							? null
							: { in: event.tokens.input, out: event.tokens.output },
					durationMs: event.durationMs,
				};
				yield {
					event: "done",
					data: JSON.stringify({ type: "@sumeru/summary", value: summary }),
				};
			} else if (event.type === "suspend") {
				yield {
					event: "suspend",
					data: JSON.stringify({
						type: "@sumeru/suspend",
						value: {
							reason: event.reason,
							nativeId: event.nativeId,
							elapsedMs: event.elapsedMs,
						},
					}),
				};
			} else if (event.type === "error") {
				yield {
					event: "error",
					data: JSON.stringify({
						type: "@sumeru/error",
						value: {
							error: "adapter_error",
							message: truncate(event.error.message, 500),
						},
					}),
				};
			}
		}
	} catch (err) {
		const adapterError = err instanceof Error ? err : new Error(String(err));
		yield {
			event: "error",
			data: JSON.stringify({
				type: "@sumeru/error",
				value: {
					error: "adapter_error",
					message: truncate(adapterError.message, 500),
				},
			}),
		};
	}
}

/**
 * Strip server-only / nullable fields from a Turn before recording so the
 * payload conforms to `@sumeru/turn`. The schema rejects extra fields
 * (`additionalProperties: false`); also drops `tokens` when null/absent and
 * `hash` (always server-injected, never persisted INSIDE the payload).
 */
function turnPayload(turn: Turn): Record<string, unknown> {
	const out: Record<string, unknown> = {
		index: turn.index,
		role: turn.role,
		content: turn.content,
		timestamp: turn.timestamp,
		toolCalls: turn.toolCalls,
	};
	if (turn.tokens !== undefined && turn.tokens !== null) {
		out.tokens = { input: turn.tokens.input, output: turn.tokens.output };
	}
	return out;
}

function truncate(s: string, max: number): string {
	if (s.length <= max) return s;
	return `${s.slice(0, max - 1)}…`;
}
