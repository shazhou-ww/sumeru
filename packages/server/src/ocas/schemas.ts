/**
 * JSON Schemas registered against the ocas store at startup.
 *
 * The schema bodies are byte-stable contracts — the schema hash is a function
 * of the schema body, so changing field order or adding properties changes
 * the hash. Treat these definitions as immutable.
 */

import type { JSONSchema } from "@ocas/core";

/**
 * `@sumeru/session-meta` — per-session metadata snapshot, written once at
 * session create. `additionalProperties: false` forces opaque adapter config
 * to live inside the `config` field rather than at the top level.
 *
 * `resolvedCwd` (issue #27) records the absolute path that Sumeru actually
 * forwarded to the adapter under the well-known `config.cwd` key, AFTER
 * `resolveSessionCwd` resolved it against the instance `workspaceRoot`. It is
 * `null` when the client did not send `config.cwd` (no cwd hint), and a
 * non-empty string otherwise. The original opaque `config` blob is preserved
 * verbatim so `config.cwd` (if present) and `resolvedCwd` together describe
 * the request → resolution mapping.
 */
export const SUMERU_SESSION_META_SCHEMA: JSONSchema = {
	title: "@sumeru/session-meta",
	description: "Per-session metadata snapshot. Written once at session create.",
	type: "object",
	additionalProperties: false,
	required: ["id", "gateway", "adapter", "createdAt", "config", "resolvedCwd"],
	properties: {
		id: { type: "string", pattern: "^ses_[0-9A-HJKMNP-TV-Z]{26}$" },
		gateway: { type: "string", minLength: 1 },
		adapter: { type: "string", minLength: 1 },
		createdAt: { type: "string", format: "date-time" },
		config: { type: "object" },
		resolvedCwd: {
			anyOf: [{ type: "null" }, { type: "string", minLength: 1 }],
		},
	},
};

/**
 * `@sumeru/turn` — one turn in a session. Used for both user and assistant
 * turns; the `role` enum excludes "system" because Sumeru does not record
 * system turns through the message endpoint.
 */
export const SUMERU_TURN_SCHEMA: JSONSchema = {
	title: "@sumeru/turn",
	description:
		"One turn in a session — a user message OR an assistant response.",
	type: "object",
	additionalProperties: false,
	required: ["index", "role", "content", "timestamp", "toolCalls"],
	properties: {
		index: { type: "integer", minimum: 0 },
		role: { type: "string", enum: ["user", "assistant"] },
		content: { type: "string" },
		timestamp: { type: "string", format: "date-time" },
		toolCalls: {
			anyOf: [
				{ type: "null" },
				{
					type: "array",
					items: {
						type: "object",
						additionalProperties: false,
						required: ["tool", "input", "output", "durationMs", "exitCode"],
						properties: {
							tool: { type: "string", minLength: 1 },
							input: { type: "object" },
							output: {
								anyOf: [{ type: "null" }, { type: "string" }],
							},
							durationMs: {
								anyOf: [{ type: "null" }, { type: "integer", minimum: 0 }],
							},
							exitCode: {
								anyOf: [{ type: "null" }, { type: "integer" }],
							},
						},
					},
				},
			],
		},
		tokens: {
			anyOf: [
				{ type: "null" },
				{
					type: "object",
					additionalProperties: false,
					required: ["input", "output"],
					properties: {
						input: { type: "integer", minimum: 0 },
						output: { type: "integer", minimum: 0 },
					},
				},
			],
		},
	},
};
