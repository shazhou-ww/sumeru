/**
 * Phase 4 — `server-ocas-schemas.md`.
 *
 * Asserts the byte-stable schema bodies, their hash determinism, and the
 * exhaustive valid/invalid payload table from the spec.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SchemaValidationError } from "@ocas/core";
import { describe, expect, it } from "vitest";
import {
	openSumeruOcas,
	recordPayload,
	SUMERU_SESSION_META_SCHEMA,
	SUMERU_TURN_SCHEMA,
	validatePayload,
} from "../src/index.js";

const HASH_RE = /^[0-9A-HJKMNP-TV-Z]{13}$/;

function tmpOcasDir(): string {
	return mkdtempSync(join(tmpdir(), "sumeru-ocas-"));
}

describe("ocas schemas — byte stability + hash determinism", () => {
	it("exposes the literal session-meta schema body", () => {
		expect(SUMERU_SESSION_META_SCHEMA.title).toBe("@sumeru/session-meta");
		expect(SUMERU_SESSION_META_SCHEMA.required).toEqual([
			"id",
			"gateway",
			"adapter",
			"createdAt",
			"config",
		]);
		expect(SUMERU_SESSION_META_SCHEMA.additionalProperties).toBe(false);
	});

	it("exposes the literal turn schema body", () => {
		expect(SUMERU_TURN_SCHEMA.title).toBe("@sumeru/turn");
		expect(SUMERU_TURN_SCHEMA.required).toEqual([
			"index",
			"role",
			"content",
			"timestamp",
			"toolCalls",
		]);
		expect(SUMERU_TURN_SCHEMA.additionalProperties).toBe(false);
	});

	it("registers two distinct hashes that match the Crockford regex", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		expect(ocas.turnSchemaHash).toMatch(HASH_RE);
		expect(ocas.sessionMetaSchemaHash).toMatch(HASH_RE);
		expect(ocas.turnSchemaHash).not.toBe(ocas.sessionMetaSchemaHash);
	});

	it("hashes are deterministic across two startups", () => {
		const a = openSumeruOcas(tmpOcasDir());
		const b = openSumeruOcas(tmpOcasDir());
		expect(a.turnSchemaHash).toBe(b.turnSchemaHash);
		expect(a.sessionMetaSchemaHash).toBe(b.sessionMetaSchemaHash);
	});
});

describe("ocas turn schema — payload validation", () => {
	it("accepts a user turn with toolCalls=null and no tokens", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		expect(() =>
			validatePayload(ocas.store, ocas.turnSchemaHash, {
				index: 0,
				role: "user",
				content: "hi",
				timestamp: "2024-01-01T00:00:00.000Z",
				toolCalls: null,
			}),
		).not.toThrow();
	});

	it("accepts an assistant turn with tool calls and tokens", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		expect(() =>
			validatePayload(ocas.store, ocas.turnSchemaHash, {
				index: 1,
				role: "assistant",
				content: "ok",
				timestamp: "2024-01-01T00:00:01.000Z",
				toolCalls: [
					{
						tool: "terminal",
						input: { cmd: "ls" },
						output: "a\nb",
						durationMs: 50,
						exitCode: 0,
					},
				],
				tokens: { input: 100, output: 50 },
			}),
		).not.toThrow();
	});

	it("rejects a turn missing toolCalls (required even when null)", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		expect(() =>
			validatePayload(ocas.store, ocas.turnSchemaHash, {
				index: 0,
				role: "user",
				content: "hi",
				timestamp: "2024-01-01T00:00:00.000Z",
			}),
		).toThrow(SchemaValidationError);
	});

	it('rejects a turn with role="system" (not in the enum)', () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		expect(() =>
			validatePayload(ocas.store, ocas.turnSchemaHash, {
				index: 0,
				role: "system",
				content: "hi",
				timestamp: "2024-01-01T00:00:00.000Z",
				toolCalls: null,
			}),
		).toThrow(SchemaValidationError);
	});

	it("rejects tokens.input = -1 (minimum 0 violated)", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		expect(() =>
			validatePayload(ocas.store, ocas.turnSchemaHash, {
				index: 0,
				role: "assistant",
				content: "hi",
				timestamp: "2024-01-01T00:00:00.000Z",
				toolCalls: null,
				tokens: { input: -1, output: 0 },
			}),
		).toThrow(SchemaValidationError);
	});
});

describe("ocas session-meta schema — payload validation", () => {
	it("accepts a minimal meta payload", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		expect(() =>
			validatePayload(ocas.store, ocas.sessionMetaSchemaHash, {
				id: "ses_01HKQQRABCDEF0123456789ZZZ",
				gateway: "hermes",
				adapter: "hermes",
				createdAt: "2024-01-01T00:00:00.000Z",
				config: {},
			}),
		).not.toThrow();
	});

	it("rejects meta with status set (additionalProperties: false)", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		expect(() =>
			validatePayload(ocas.store, ocas.sessionMetaSchemaHash, {
				id: "ses_01HKQQRABCDEF0123456789ZZZ",
				gateway: "hermes",
				adapter: "hermes",
				createdAt: "2024-01-01T00:00:00.000Z",
				config: {},
				status: "closed",
			}),
		).toThrow(SchemaValidationError);
	});

	it("rejects a meta missing the adapter field", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		expect(() =>
			validatePayload(ocas.store, ocas.sessionMetaSchemaHash, {
				id: "ses_01HKQQRABCDEF0123456789ZZZ",
				gateway: "hermes",
				createdAt: "2024-01-01T00:00:00.000Z",
				config: {},
			}),
		).toThrow(SchemaValidationError);
	});

	it("recordPayload writes a valid meta and returns a 13-char hash", () => {
		const ocas = openSumeruOcas(tmpOcasDir());
		const hash = recordPayload(ocas.store, ocas.sessionMetaSchemaHash, {
			id: "ses_01HKQQRABCDEF0123456789ZZZ",
			gateway: "hermes",
			adapter: "hermes",
			createdAt: "2024-01-01T00:00:00.000Z",
			config: { model: "x" },
		});
		expect(hash).toMatch(HASH_RE);
		expect(ocas.store.cas.has(hash)).toBe(true);
	});
});
