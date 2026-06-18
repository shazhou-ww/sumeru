/**
 * Unit tests for the CLI's `buildAdapters` factory.
 *
 * These tests inject a fake adapter factory map so each gateway's parsed
 * `config:` blob is observable without spawning a real process. See
 * `specs/cli-pass-gateway-config.md` (issue #32).
 */

import type { Adapter, SendEvent, SessionConfig } from "@sumeru/core";
import type { GatewayConfig } from "@sumeru/server";
import { describe, expect, it } from "vitest";
import {
	type AdapterFactoryMap,
	buildAdapters,
} from "../src/build-adapters.js";

function fakeAdapter(name: string): Adapter {
	return {
		name,
		createSession: async (_config: SessionConfig) => ({
			nativeId: "x",
			meta: {},
		}),
		send(_ref, _content): AsyncIterable<SendEvent> {
			async function* generate(): AsyncGenerator<SendEvent> {
				yield { type: "done", durationMs: 0, tokens: null };
			}
			return generate();
		},
		close: async () => {},
		getTurns: async () => [],
	};
}

function makeRecorder(): {
	calls: Array<{ adapter: string; opts: Record<string, unknown> }>;
	factories: AdapterFactoryMap;
} {
	const calls: Array<{ adapter: string; opts: Record<string, unknown> }> = [];
	const factories: AdapterFactoryMap = {
		hermes: (opts) => {
			calls.push({ adapter: "hermes", opts });
			return fakeAdapter("hermes");
		},
		"claude-code": (opts) => {
			calls.push({ adapter: "claude-code", opts });
			return fakeAdapter("claude-code");
		},
	};
	return { calls, factories };
}

describe("buildAdapters — gateway config forwarding (issue #32)", () => {
	it("calls each factory with `{}` when no gateway has a config blob", () => {
		const { calls, factories } = makeRecorder();
		const gateways: Record<string, GatewayConfig> = {
			hermes: {
				adapter: "hermes",
				capabilities: { resume: true, streaming: true },
				config: null,
			},
			"claude-code": {
				adapter: "claude-code",
				capabilities: { resume: true, streaming: false },
				config: null,
			},
		};
		const adapters = buildAdapters(gateways, factories);
		expect(Object.keys(adapters).sort()).toEqual(["claude-code", "hermes"]);
		expect(calls).toEqual([
			{ adapter: "hermes", opts: {} },
			{ adapter: "claude-code", opts: {} },
		]);
	});

	it("forwards a populated config blob verbatim to the matching factory", () => {
		const { calls, factories } = makeRecorder();
		const gateways: Record<string, GatewayConfig> = {
			"claude-code": {
				adapter: "claude-code",
				capabilities: { resume: true, streaming: true },
				config: {
					sendTimeoutMs: 1_800_000,
					createSessionTimeoutMs: 300_000,
					maxTurns: 120,
				},
			},
		};
		buildAdapters(gateways, factories);
		expect(calls).toEqual([
			{
				adapter: "claude-code",
				opts: {
					sendTimeoutMs: 1_800_000,
					createSessionTimeoutMs: 300_000,
					maxTurns: 120,
				},
			},
		]);
	});

	it("creates independent adapter instances when two gateways share an adapter type", () => {
		const calls: Array<Record<string, unknown>> = [];
		const factories: AdapterFactoryMap = {
			"claude-code": (opts) => {
				calls.push(opts);
				return fakeAdapter("claude-code");
			},
		};
		const gateways: Record<string, GatewayConfig> = {
			"cc-fast": {
				adapter: "claude-code",
				capabilities: { resume: true, streaming: false },
				config: { sendTimeoutMs: 60_000 },
			},
			"cc-slow": {
				adapter: "claude-code",
				capabilities: { resume: true, streaming: false },
				config: { sendTimeoutMs: 1_800_000 },
			},
		};
		const adapters = buildAdapters(gateways, factories);
		expect(Object.keys(adapters).sort()).toEqual(["cc-fast", "cc-slow"]);
		expect(adapters["cc-fast"]).not.toBe(adapters["cc-slow"]);
		expect(calls).toEqual([
			{ sendTimeoutMs: 60_000 },
			{ sendTimeoutMs: 1_800_000 },
		]);
	});

	it("silently skips gateways whose adapter is unknown (no throw)", () => {
		const { calls, factories } = makeRecorder();
		const gateways: Record<string, GatewayConfig> = {
			hermes: {
				adapter: "hermes",
				capabilities: { resume: true, streaming: true },
				config: null,
			},
			weird: {
				adapter: "bogus",
				capabilities: { resume: false, streaming: false },
				config: null,
			},
		};
		const adapters = buildAdapters(gateways, factories);
		expect(Object.keys(adapters)).toEqual(["hermes"]);
		expect(calls).toEqual([{ adapter: "hermes", opts: {} }]);
	});

	it("does not validate the contents of `config` (passes through arbitrary keys)", () => {
		const { calls, factories } = makeRecorder();
		const gateways: Record<string, GatewayConfig> = {
			hermes: {
				adapter: "hermes",
				capabilities: { resume: true, streaming: true },
				// Deliberately weird shape — the CLI must NOT validate.
				config: { spawnFn: "haha", arbitraryKey: 42 },
			},
		};
		buildAdapters(gateways, factories);
		expect(calls[0]?.opts).toEqual({ spawnFn: "haha", arbitraryKey: 42 });
	});

	it("returns an empty registry for an empty gateways map", () => {
		const { factories } = makeRecorder();
		const adapters = buildAdapters({}, factories);
		expect(adapters).toEqual({});
	});
});
