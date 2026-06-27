import { describe, expect, it } from "vitest";
import { generateSessionId } from "../src/session/id.js";

const ID_REGEX = /^ses_[0-9A-HJKMNP-TV-Z]{26}$/;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function decodeUlidTime(ulid: string): number {
	const head = ulid.slice(0, 10);
	let ms = 0;
	for (const ch of head) {
		const v = CROCKFORD.indexOf(ch);
		if (v < 0) throw new Error(`bad ulid char: ${ch}`);
		ms = ms * 32 + v;
	}
	return ms;
}

describe("generateSessionId", () => {
	it("returns a 30-character string starting with ses_", () => {
		const id = generateSessionId();
		expect(id.length).toBe(30);
		expect(id.startsWith("ses_")).toBe(true);
	});

	it("matches the ses_<26-char-Crockford-ULID> regex", () => {
		const id = generateSessionId();
		expect(id).toMatch(ID_REGEX);
	});

	it("never contains the excluded Crockford letters I, L, O, U", () => {
		for (let i = 0; i < 200; i += 1) {
			const id = generateSessionId().slice(4);
			expect(id).not.toMatch(/[ILOU]/);
		}
	});

	it("emits the body as uppercase Crockford characters only", () => {
		for (let i = 0; i < 200; i += 1) {
			const body = generateSessionId().slice(4);
			for (const ch of body) {
				expect(CROCKFORD).toContain(ch);
			}
		}
	});

	it("encodes a millisecond timestamp within 5 s of now in the first 10 chars", () => {
		const before = Date.now();
		const id = generateSessionId();
		const after = Date.now();
		const ms = decodeUlidTime(id.slice(4));
		expect(ms).toBeGreaterThanOrEqual(before - 5);
		expect(ms).toBeLessThanOrEqual(after + 5);
	});

	it("produces 1000 distinct ids in a tight loop (monotonic ULID)", () => {
		const seen = new Set<string>();
		for (let i = 0; i < 1000; i += 1) {
			seen.add(generateSessionId());
		}
		expect(seen.size).toBe(1000);
	});

	it("session ids are stable in case (uppercase body)", () => {
		const id = generateSessionId();
		expect(id.slice(4)).toBe(id.slice(4).toUpperCase());
	});
});
