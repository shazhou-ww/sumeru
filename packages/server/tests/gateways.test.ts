import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GatewayConfig, StartedServer } from "../src/index.js";
import { startServer } from "../src/index.js";
import { makeStubAdapter } from "./fixtures/stub-adapter.js";

const TWO_GATEWAYS: Record<string, GatewayConfig> = {
	hermes: {
		adapter: "hermes",
		capabilities: { resume: true, streaming: true },
	},
	"claude-code": {
		adapter: "claude-code",
		capabilities: { resume: true, streaming: false },
	},
};

function makeAdapters(): Record<
	string,
	ReturnType<typeof makeStubAdapter>["adapter"]
> {
	return {
		hermes: makeStubAdapter({ name: "hermes" }).adapter,
		"claude-code": makeStubAdapter({ name: "claude-code" }).adapter,
	};
}

describe("@sumeru/server — GET / reflects config", () => {
	let server: StartedServer;
	let baseUrl: string;

	beforeAll(async () => {
		server = await startServer({
			port: 0,
			host: "127.0.0.1",
			name: "sumeru@neko",
			version: "0.1.0",
			gateways: TWO_GATEWAYS,
		});
		baseUrl = `http://${server.host}:${server.port}`;
	});

	afterAll(async () => {
		await server.stop();
	});

	it("returns @sumeru/instance with name from config and gateways as ordered names", async () => {
		const res = await fetch(`${baseUrl}/`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type") ?? "").toMatch(/^application\/json/);
		const body = (await res.json()) as unknown;
		expect(body).toEqual({
			type: "@sumeru/instance",
			value: {
				name: "sumeru@neko",
				version: "0.1.0",
				gateways: ["hermes", "claude-code"],
			},
		});
	});

	it("envelope has exactly two top-level keys", async () => {
		const res = await fetch(`${baseUrl}/`);
		const body = (await res.json()) as Record<string, unknown>;
		expect(Object.keys(body).sort()).toEqual(["type", "value"]);
	});

	it("POST / still returns 405 with Allow: GET", async () => {
		const res = await fetch(`${baseUrl}/`, { method: "POST" });
		expect(res.status).toBe(405);
		expect(res.headers.get("allow")).toBe("GET");
	});
});

describe("@sumeru/server — GET /gateways", () => {
	let server: StartedServer;
	let baseUrl: string;

	beforeAll(async () => {
		server = await startServer({
			port: 0,
			host: "127.0.0.1",
			name: "sumeru@neko",
			version: "0.1.0",
			gateways: TWO_GATEWAYS,
			adapters: makeAdapters(),
			sseHeartbeatMs: null,
			sseBufferSize: null,
			sseRetentionMs: null,
		});
		baseUrl = `http://${server.host}:${server.port}`;
	});

	afterAll(async () => {
		await server.stop();
	});

	it("returns @sumeru/gateway-list envelope with all gateways in YAML order", async () => {
		const res = await fetch(`${baseUrl}/gateways`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type") ?? "").toMatch(/^application\/json/);
		const body = (await res.json()) as unknown;
		expect(body).toEqual({
			type: "@sumeru/gateway-list",
			value: [
				{
					name: "hermes",
					adapter: "hermes",
					status: "ready",
					activeSessions: 0,
					capabilities: { resume: true, streaming: true },
				},
				{
					name: "claude-code",
					adapter: "claude-code",
					status: "ready",
					activeSessions: 0,
					capabilities: { resume: true, streaming: false },
				},
			],
		});
	});

	it("treats GET /gateways/ (trailing slash) the same as GET /gateways", async () => {
		const res = await fetch(`${baseUrl}/gateways/`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { type: string; value: unknown[] };
		expect(body.type).toBe("@sumeru/gateway-list");
		expect(Array.isArray(body.value)).toBe(true);
		expect(body.value).toHaveLength(2);
	});

	it("ignores query-string parameters", async () => {
		const res = await fetch(`${baseUrl}/gateways?anything=ignored`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { type: string; value: unknown[] };
		expect(body.type).toBe("@sumeru/gateway-list");
		expect(body.value).toHaveLength(2);
	});

	it("each entry has exactly the five Phase 1 keys", async () => {
		const res = await fetch(`${baseUrl}/gateways`);
		const body = (await res.json()) as {
			value: Array<Record<string, unknown>>;
		};
		for (const entry of body.value) {
			expect(Object.keys(entry).sort()).toEqual([
				"activeSessions",
				"adapter",
				"capabilities",
				"name",
				"status",
			]);
		}
	});

	it("returns 405 with Allow: GET on POST /gateways", async () => {
		const res = await fetch(`${baseUrl}/gateways`, { method: "POST" });
		expect(res.status).toBe(405);
		expect(res.headers.get("allow")).toBe("GET");
		const body = (await res.json()) as { value: { error: string } };
		expect(body.value.error).toBe("method_not_allowed");
	});
});

describe("@sumeru/server — GET /gateways with empty config", () => {
	let server: StartedServer;
	let baseUrl: string;

	beforeAll(async () => {
		server = await startServer({
			port: 0,
			host: "127.0.0.1",
			name: "sumeru",
			version: "0.1.0",
			gateways: {},
		});
		baseUrl = `http://${server.host}:${server.port}`;
	});

	afterAll(async () => {
		await server.stop();
	});

	it("returns an empty array (never null)", async () => {
		const res = await fetch(`${baseUrl}/gateways`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { type: string; value: unknown };
		expect(body.type).toBe("@sumeru/gateway-list");
		expect(body.value).toEqual([]);
	});
});

describe("@sumeru/server — GET /gateways/:name", () => {
	let server: StartedServer;
	let baseUrl: string;

	beforeAll(async () => {
		server = await startServer({
			port: 0,
			host: "127.0.0.1",
			name: "sumeru@neko",
			version: "0.1.0",
			gateways: TWO_GATEWAYS,
			adapters: makeAdapters(),
			sseHeartbeatMs: null,
			sseBufferSize: null,
			sseRetentionMs: null,
		});
		baseUrl = `http://${server.host}:${server.port}`;
	});

	afterAll(async () => {
		await server.stop();
	});

	it("returns @sumeru/gateway envelope for hermes", async () => {
		const res = await fetch(`${baseUrl}/gateways/hermes`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type") ?? "").toMatch(/^application\/json/);
		const body = (await res.json()) as unknown;
		expect(body).toEqual({
			type: "@sumeru/gateway",
			value: {
				name: "hermes",
				adapter: "hermes",
				status: "ready",
				activeSessions: 0,
				capabilities: { resume: true, streaming: true },
			},
		});
	});

	it("returns @sumeru/gateway envelope for claude-code", async () => {
		const res = await fetch(`${baseUrl}/gateways/claude-code`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			type: string;
			value: {
				name: string;
				adapter: string;
				capabilities: { streaming: boolean };
			};
		};
		expect(body.type).toBe("@sumeru/gateway");
		expect(body.value.name).toBe("claude-code");
		expect(body.value.adapter).toBe("claude-code");
		expect(body.value.capabilities.streaming).toBe(false);
	});

	it("treats trailing slash equivalently", async () => {
		const res = await fetch(`${baseUrl}/gateways/hermes/`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { type: string };
		expect(body.type).toBe("@sumeru/gateway");
	});

	it("returns 404 with @sumeru/error gateway_not_found for unknown name", async () => {
		const res = await fetch(`${baseUrl}/gateways/does-not-exist`);
		expect(res.status).toBe(404);
		expect(res.headers.get("content-type") ?? "").toMatch(/^application\/json/);
		const body = (await res.json()) as {
			type: string;
			value: { error: string; message: string };
		};
		expect(body).toEqual({
			type: "@sumeru/error",
			value: {
				error: "gateway_not_found",
				message: "Gateway does-not-exist not found",
			},
		});
	});

	it("uses gateway_not_found, distinct from generic not_found", async () => {
		const detailRes = await fetch(`${baseUrl}/gateways/missing`);
		const detailBody = (await detailRes.json()) as { value: { error: string } };
		const unknownRes = await fetch(`${baseUrl}/totally-unknown-path`);
		const unknownBody = (await unknownRes.json()) as {
			value: { error: string };
		};

		expect(detailBody.value.error).toBe("gateway_not_found");
		expect(unknownBody.value.error).toBe("not_found");
	});

	it("does case-sensitive lookup (HERMES != hermes)", async () => {
		const res = await fetch(`${baseUrl}/gateways/HERMES`);
		expect(res.status).toBe(404);
		const body = (await res.json()) as {
			type: string;
			value: { error: string };
		};
		expect(body.type).toBe("@sumeru/error");
		expect(body.value.error).toBe("gateway_not_found");
	});

	it("treats path-traversal probes as literal names (404 gateway_not_found, no FS access)", async () => {
		const res = await fetch(`${baseUrl}/gateways/%2E%2E%2Fetc%2Fpasswd`);
		expect(res.status).toBe(404);
		const body = (await res.json()) as {
			type: string;
			value: { error: string };
		};
		expect(body.type).toBe("@sumeru/error");
		expect(body.value.error).toBe("gateway_not_found");
	});

	it("returns 405 with Allow: GET on POST /gateways/hermes", async () => {
		const res = await fetch(`${baseUrl}/gateways/hermes`, {
			method: "POST",
		});
		expect(res.status).toBe(405);
		expect(res.headers.get("allow")).toBe("GET");
		const body = (await res.json()) as {
			type: string;
			value: { error: string };
		};
		expect(body.type).toBe("@sumeru/error");
		expect(body.value.error).toBe("method_not_allowed");
	});
});
