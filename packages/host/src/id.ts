import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TIME_LEN = 10;
const RAND_LEN = 16;

let lastTime = 0;
let lastRandom: number[] = new Array<number>(RAND_LEN).fill(0);

export function generateSessionId(): string {
	return `ses_${generateUlid()}`;
}

export function generateMessageId(): string {
	return `msg_${generateUlid()}`;
}

export function generateCommandId(): string {
	return `cmd_${generateUlid()}`;
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
		out[i] = CROCKFORD.charAt(mod);
		value = Math.floor(value / 32);
	}
	return out.join("");
}

function freshRandom(): number[] {
	const buf = randomBytes(RAND_LEN);
	const out: number[] = new Array<number>(RAND_LEN).fill(0);
	for (let i = 0; i < RAND_LEN; i += 1) {
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

export function projectNameFromSessionId(sessionId: string): string {
	return sessionId.replaceAll("_", "-").toLowerCase();
}
