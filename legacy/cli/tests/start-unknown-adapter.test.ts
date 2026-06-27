/**
 * Test for the unknown-adapter degradation path: `sumeru.yaml` with
 * `adapter: bogus` must NOT crash the CLI. The unknown gateway is omitted
 * from the adapters map, and `GET /gateways` reports it as `status:
 * "unavailable"`.
 *
 * See `specs/cli-pass-gateway-config.md` (issue #32).
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, startServer } from "@sumeru/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildAdapters } from "../src/build-adapters.js";

function tmpOcasDir(): string {
	return mkdtempSync(join(tmpdir(), "sumeru-ocas-"));
}

function fixtureDir(): string {
	return mkdtempSync(join(tmpdir(), "sumeru-cli-fixture-"));
}

describe("CLI start with unknown adapter (issue #32)", () => {
	let stop: (() => Promise<void>) | null = null;

	beforeEach(() => {
		stop = null;
	});

	afterEach(async () => {
		if (stop !== null) {
			await stop();
			stop = null;
		}
	});

	it("does not crash on `adapter: bogus` and reports unavailable", async () => {
		const dir = fixtureDir();
		const yamlPath = join(dir, "sumeru.yaml");
		writeFileSync(
			yamlPath,
			[
				"name: sumeru@neko",
				"gateways:",
				"  weird:",
				"    adapter: bogus",
				"    capabilities:",
				"      resume: false",
				"      streaming: false",
				"",
			].join("\n"),
			"utf-8",
		);
		const cfg = await loadConfig(yamlPath);
		// Default factories — buildAdapters must NOT throw for the unknown name.
		const adapters = buildAdapters(cfg.gateways);
		expect(Object.keys(adapters)).toEqual([]);

		const server = await startServer({
			port: 0,
			host: "127.0.0.1",
			name: cfg.name,
			version: "0.0.0",
			gateways: cfg.gateways,
			workspaceRoot: cfg.workspaceRoot,
			adapters,
			sseHeartbeatMs: null,
			sseBufferSize: null,
			sseRetentionMs: null,
			ocasDir: tmpOcasDir(),
		});
		stop = server.stop;
		const res = await fetch(`http://${server.host}:${server.port}/gateways`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			value: Array<{ name: string; adapter: string; status: string }>;
		};
		expect(body.value).toEqual([
			{
				name: "weird",
				adapter: "bogus",
				status: "unavailable",
				activeSessions: 0,
				capabilities: { resume: false, streaming: false },
			},
		]);
	});
});
