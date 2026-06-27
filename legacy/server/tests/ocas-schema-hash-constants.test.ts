/**
 * Issue #62 — schema hash constants are statically importable.
 *
 * Asserts that the hardcoded hash constants stay in sync with the
 * deterministic hash computed from the schema bodies at runtime.
 */

import { computeSelfHashSync, initHasher } from "@ocas/core";
import { beforeAll, describe, expect, it } from "vitest";
import {
	SUMERU_SESSION_META_SCHEMA,
	SUMERU_SESSION_META_SCHEMA_HASH,
	SUMERU_TURN_SCHEMA,
	SUMERU_TURN_SCHEMA_HASH,
} from "../src/index.js";

const HASH_RE = /^[0-9A-HJKMNP-TV-Z]{13}$/;

describe("schema hash constants — static exports", () => {
	beforeAll(async () => {
		await initHasher();
	});

	it("SUMERU_TURN_SCHEMA_HASH matches computeSelfHashSync(SUMERU_TURN_SCHEMA)", () => {
		expect(SUMERU_TURN_SCHEMA_HASH).toBe(
			computeSelfHashSync(SUMERU_TURN_SCHEMA),
		);
	});

	it("SUMERU_SESSION_META_SCHEMA_HASH matches computeSelfHashSync(SUMERU_SESSION_META_SCHEMA)", () => {
		expect(SUMERU_SESSION_META_SCHEMA_HASH).toBe(
			computeSelfHashSync(SUMERU_SESSION_META_SCHEMA),
		);
	});

	it("both constants match the Crockford Base32 regex", () => {
		expect(SUMERU_TURN_SCHEMA_HASH).toMatch(HASH_RE);
		expect(SUMERU_SESSION_META_SCHEMA_HASH).toMatch(HASH_RE);
	});

	it("the two constants are not equal to each other", () => {
		expect(SUMERU_TURN_SCHEMA_HASH).not.toBe(SUMERU_SESSION_META_SCHEMA_HASH);
	});
});
