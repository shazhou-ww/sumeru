import { randomBytes } from "node:crypto";

/**
 * Crockford Base32 alphabet (excludes I, L, O, U).
 * Used by ULID for both timestamp and randomness components.
 */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Length of the timestamp portion of a ULID (in Crockford chars). */
const TIME_LEN = 10;

/** Length of the randomness portion of a ULID. */
const RAND_LEN = 16;

/** State for monotonic ULID generation when timestamps collide. */
let lastTime = 0;
let lastRandom: number[] = new Array<number>(RAND_LEN).fill(0);

/**
 * Generate a Sumeru session ID: `ses_` followed by a 26-character ULID
 * (Crockford Base32, uppercase).
 *
 * - Total length: 30 (4 prefix + 26 body).
 * - Body matches `^[0-9A-HJKMNP-TV-Z]{26}$`.
 * - First 10 body characters encode milliseconds since the Unix epoch.
 * - Subsequent calls within the same millisecond emit a strictly increasing
 *   randomness component (monotonic ULID), guaranteeing distinct ids.
 */
export function generateSessionId(): string {
	return `ses_${generateUlid()}`;
}

function generateUlid(): string {
	const now = Date.now();
	const random = now === lastTime ? incrementRandom(lastRandom) : freshRandom();
	lastTime = now;
	lastRandom = random;
	return `${encodeTime(now)}${encodeRandom(random)}`;
}

function encodeTime(ms: number): string {
	const out: string[] = new Array<string>(TIME_LEN).fill("0");
	let value = ms;
	for (let i = TIME_LEN - 1; i >= 0; i -= 1) {
		const mod = value % 32;
		// Crockford alphabet has length 32, so mod is always in range.
		out[i] = CROCKFORD.charAt(mod);
		value = Math.floor(value / 32);
	}
	return out.join("");
}

function freshRandom(): number[] {
	const buf = randomBytes(RAND_LEN);
	const out: number[] = new Array<number>(RAND_LEN).fill(0);
	for (let i = 0; i < RAND_LEN; i += 1) {
		// 0–31 (5-bit) values for Crockford Base32.
		out[i] = (buf[i] ?? 0) & 0x1f;
	}
	return out;
}

function incrementRandom(prev: number[]): number[] {
	const out = prev.slice();
	for (let i = RAND_LEN - 1; i >= 0; i -= 1) {
		const v = out[i] ?? 0;
		if (v < 31) {
			out[i] = v + 1;
			return out;
		}
		out[i] = 0;
	}
	// Overflow within a single millisecond is astronomically unlikely; fall back
	// to a fresh random vector rather than failing the call.
	return freshRandom();
}

function encodeRandom(values: number[]): string {
	const out: string[] = new Array<string>(RAND_LEN).fill("0");
	for (let i = 0; i < RAND_LEN; i += 1) {
		const v = values[i] ?? 0;
		out[i] = CROCKFORD.charAt(v);
	}
	return out.join("");
}
