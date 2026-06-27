// Shared test harness for the adapter-core NDJSON entrypoint.
// Provides an in-memory stdin (PassThrough), a synchronous stdout capture,
// an injectable SIGTERM hook, and small async-flush utilities. No child
// process and no real OS signals are used.

import { PassThrough } from "node:stream";
import { runAdapterEntry } from "../src/entrypoint.js";
import type { AdapterEntryOptions, OutboundFrame } from "../src/types.js";

export type Deferred<T> = {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (reason?: unknown) => void;
};

export function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

// Synchronous stdout capture: the entrypoint only calls `write`, so a minimal
// fake keeps every assertion about emitted bytes deterministic.
export type StdoutCapture = {
	stream: NodeJS.WritableStream;
	text(): string;
	frames(): Array<OutboundFrame>;
};

export function makeStdout(): StdoutCapture {
	let buffer = "";
	const fake = {
		write(chunk: string | Uint8Array): boolean {
			buffer +=
				typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
			return true;
		},
		end(): void {},
	};
	return {
		stream: fake as unknown as NodeJS.WritableStream,
		text: () => buffer,
		frames: () =>
			buffer
				.split("\n")
				.filter((line) => line.length > 0)
				.map((line) => JSON.parse(line) as OutboundFrame),
	};
}

// Injectable SIGTERM seam: capture the registered handler so a test can fire it
// deterministically, and track disposal.
export type SigtermHook = {
	hook: (handler: () => void) => () => void;
	fire(): void;
	disposed(): boolean;
	registered(): boolean;
};

export function makeSigtermHook(): SigtermHook {
	let handler: (() => void) | null = null;
	let isDisposed = false;
	return {
		hook(h) {
			handler = h;
			return () => {
				isDisposed = true;
			};
		},
		fire() {
			if (handler !== null) handler();
		},
		disposed: () => isDisposed,
		registered: () => handler !== null,
	};
}

export function makeStdin(): PassThrough {
	return new PassThrough();
}

export function runTestEntry(
	options: Omit<AdapterEntryOptions, "sendTimeoutMs"> & {
		sendTimeoutMs?: number | null;
	},
): Promise<void> {
	return runAdapterEntry({
		...options,
		sendTimeoutMs: options.sendTimeoutMs ?? null,
	});
}

// Flush pending macro/microtasks so event-driven reads settle.
export async function flush(times = 3): Promise<void> {
	for (let i = 0; i < times; i++) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
}
