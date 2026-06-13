import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

const ID_REGEX = /^ses_[0-9A-HJKMNP-TV-Z]{26}$/;

type SessionValue = {
	id: string;
	gateway: string;
	status: string;
	createdAt: string;
	config: Record<string, unknown>;
};

type SessionListEntryShape = {
	id: string;
	gateway: string;
	status: string;
	createdAt: string;
};

type ErrorBody = {
	type: string;
	value: { error: string; message: string };
};

async function startTestServer(): Promise<{
	server: StartedServer;
	baseUrl: string;
}> {
	const hermes = makeStubAdapter({ name: "hermes" });
	const claude = makeStubAdapter({ name: "claude-code" });
	const server = await startServer({
		port: 0,
		host: "127.0.0.1",
		name: "sumeru@neko",
		version: "0.1.0",
		gateways: TWO_GATEWAYS,
		adapters: {
			hermes: hermes.adapter,
			"claude-code": claude.adapter,
		},
		sseHeartbeatMs: null,
		sseBufferSize: null,
		sseRetentionMs: null,
	});
	return {
		server,
		baseUrl: `http://${server.host}:${server.port}`,
	};
}

describe("@sumeru/server — POST /gateways/:name/sessions", () => {
	let server: StartedServer;
	let baseUrl: string;

	beforeEach(async () => {
		const ctx = await startTestServer();
		server = ctx.server;
		baseUrl = ctx.baseUrl;
	});

	afterEach(async () => {
		await server.stop();
	});

	it("returns 201 + @sumeru/session envelope with idle status", async () => {
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		expect(res.status).toBe(201);
		expect(res.headers.get("content-type") ?? "").toMatch(/^application\/json/);
		const body = (await res.json()) as { type: string; value: SessionValue };
		expect(body.type).toBe("@sumeru/session");
		expect(Object.keys(body).sort()).toEqual(["type", "value"]);
		expect(Object.keys(body.value).sort()).toEqual([
			"config",
			"createdAt",
			"gateway",
			"id",
			"status",
		]);
		expect(body.value.id).toMatch(ID_REGEX);
		expect(body.value.gateway).toBe("hermes");
		expect(body.value.status).toBe("idle");
		expect(body.value.config).toEqual({});
		// createdAt within 5s of now
		const t = Date.parse(body.value.createdAt);
		expect(Number.isFinite(t)).toBe(true);
		expect(Math.abs(Date.now() - t)).toBeLessThan(5000);
		expect(body.value.createdAt.endsWith("Z")).toBe(true);
	});

	it("treats an empty body the same as {}", async () => {
		const res = await fetch(`${baseUrl}/gateways/claude-code/sessions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "",
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as { value: SessionValue };
		expect(body.value.config).toEqual({});
		expect(body.value.gateway).toBe("claude-code");
	});

	it("treats config as opaque — round-trips unknown fields verbatim", async () => {
		const cfg = {
			model: "sonnet-4.5",
			systemPrompt: "be brief",
			temperature: 0.2,
			weirdAdapterField: 42,
		};
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ config: cfg }),
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as { value: SessionValue };
		expect(body.value.config).toEqual(cfg);
	});

	it("returns 400 invalid_json for malformed JSON", async () => {
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: '{"config":',
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as ErrorBody;
		expect(body.type).toBe("@sumeru/error");
		expect(body.value.error).toBe("invalid_json");
		// no session was created
		const list = await fetch(`${baseUrl}/gateways/hermes/sessions`);
		const listBody = (await list.json()) as {
			value: SessionListEntryShape[];
		};
		expect(listBody.value).toEqual([]);
	});

	it("returns 400 invalid_request when config is the wrong type", async () => {
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ config: "not-an-object" }),
		});
		expect(res.status).toBe(400);
		const body = (await res.json()) as ErrorBody;
		expect(body.value.error).toBe("invalid_request");
		expect(body.value.message).toContain("config");
	});

	it("returns 404 gateway_not_found for unknown gateway", async () => {
		const res = await fetch(`${baseUrl}/gateways/does-not-exist/sessions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		expect(res.status).toBe(404);
		const body = (await res.json()) as ErrorBody;
		expect(body.value.error).toBe("gateway_not_found");
		expect(body.value.message).toContain("does-not-exist");
	});

	it("ignores any client-supplied id in the body (server generates ses_…)", async () => {
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ id: "ses_CLIENT_INJECTED" }),
		});
		expect(res.status).toBe(201);
		const body = (await res.json()) as { value: SessionValue };
		expect(body.value.id).toMatch(ID_REGEX);
		expect(body.value.id).not.toBe("ses_CLIENT_INJECTED");
	});

	it("returns 405 with Allow: GET, POST on PUT /gateways/:name/sessions", async () => {
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions`, {
			method: "PUT",
		});
		expect(res.status).toBe(405);
		expect(res.headers.get("allow")).toBe("GET, POST");
	});
});

describe("@sumeru/server — GET /gateways/:name/sessions (list)", () => {
	let server: StartedServer;
	let baseUrl: string;

	beforeEach(async () => {
		const ctx = await startTestServer();
		server = ctx.server;
		baseUrl = ctx.baseUrl;
	});

	afterEach(async () => {
		await server.stop();
	});

	async function postSession(
		gateway: string,
		body: unknown = {},
	): Promise<SessionValue> {
		const res = await fetch(`${baseUrl}/gateways/${gateway}/sessions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		const parsed = (await res.json()) as { value: SessionValue };
		return parsed.value;
	}

	it("returns an empty array (never null) for a gateway with no sessions", async () => {
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			type: string;
			value: SessionListEntryShape[];
		};
		expect(body.type).toBe("@sumeru/session-list");
		expect(body.value).toEqual([]);
		expect(Array.isArray(body.value)).toBe(true);
	});

	it("returns sessions in chronological insertion order, omitting config", async () => {
		const a = await postSession("hermes", {});
		const b = await postSession("hermes", { config: { model: "sonnet-4.5" } });
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			value: Array<Record<string, unknown>>;
		};
		expect(body.value.map((s) => s.id)).toEqual([a.id, b.id]);
		for (const entry of body.value) {
			expect(Object.keys(entry).sort()).toEqual([
				"createdAt",
				"gateway",
				"id",
				"status",
			]);
		}
	});

	it("includes closed sessions in the listing", async () => {
		const a = await postSession("hermes", {});
		const b = await postSession("hermes", {});
		const c = await postSession("hermes", {});
		// Close C
		const del = await fetch(`${baseUrl}/gateways/hermes/sessions/${c.id}`, {
			method: "DELETE",
		});
		expect(del.status).toBe(204);
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions`);
		const body = (await res.json()) as {
			value: SessionListEntryShape[];
		};
		expect(body.value.map((s) => s.id)).toEqual([a.id, b.id, c.id]);
		const cEntry = body.value.find((s) => s.id === c.id);
		expect(cEntry?.status).toBe("closed");
	});

	it("scopes listings per gateway", async () => {
		const a = await postSession("hermes", {});
		const d = await postSession("claude-code", {});
		const hermes = await fetch(`${baseUrl}/gateways/hermes/sessions`);
		const cc = await fetch(`${baseUrl}/gateways/claude-code/sessions`);
		const hermesBody = (await hermes.json()) as {
			value: SessionListEntryShape[];
		};
		const ccBody = (await cc.json()) as {
			value: SessionListEntryShape[];
		};
		expect(hermesBody.value.map((s) => s.id)).toEqual([a.id]);
		expect(ccBody.value.map((s) => s.id)).toEqual([d.id]);
	});

	it("treats trailing slash equivalently", async () => {
		await postSession("hermes", {});
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions/`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			value: SessionListEntryShape[];
		};
		expect(body.value).toHaveLength(1);
	});

	it("returns 404 gateway_not_found for unknown gateway", async () => {
		const res = await fetch(`${baseUrl}/gateways/does-not-exist/sessions`);
		expect(res.status).toBe(404);
		const body = (await res.json()) as ErrorBody;
		expect(body.value.error).toBe("gateway_not_found");
	});

	it("returns 405 with Allow: GET, POST on DELETE at the collection", async () => {
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions`, {
			method: "DELETE",
		});
		expect(res.status).toBe(405);
		expect(res.headers.get("allow")).toBe("GET, POST");
	});

	it("ignores unknown query parameters", async () => {
		await postSession("hermes", {});
		const res = await fetch(
			`${baseUrl}/gateways/hermes/sessions?status=idle&q=foo`,
		);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			value: SessionListEntryShape[];
		};
		expect(body.value).toHaveLength(1);
	});
});

describe("@sumeru/server — GET /gateways/:name/sessions/:id (detail)", () => {
	let server: StartedServer;
	let baseUrl: string;

	beforeEach(async () => {
		const ctx = await startTestServer();
		server = ctx.server;
		baseUrl = ctx.baseUrl;
	});

	afterEach(async () => {
		await server.stop();
	});

	async function postSession(
		gateway: string,
		body: unknown = {},
	): Promise<SessionValue> {
		const res = await fetch(`${baseUrl}/gateways/${gateway}/sessions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		const parsed = (await res.json()) as { value: SessionValue };
		return parsed.value;
	}

	it("returns 200 + full @sumeru/session for a live session", async () => {
		const a = await postSession("hermes", {
			config: { model: "sonnet-4.5", systemPrompt: "be brief" },
		});
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions/${a.id}`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { type: string; value: SessionValue };
		expect(body.type).toBe("@sumeru/session");
		expect(body.value.id).toBe(a.id);
		expect(body.value.gateway).toBe("hermes");
		expect(body.value.status).toBe("idle");
		expect(body.value.config).toEqual({
			model: "sonnet-4.5",
			systemPrompt: "be brief",
		});
	});

	it("returns 200 with status=closed for closed sessions", async () => {
		const a = await postSession("hermes", {});
		await fetch(`${baseUrl}/gateways/hermes/sessions/${a.id}`, {
			method: "DELETE",
		});
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions/${a.id}`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { value: SessionValue };
		expect(body.value.status).toBe("closed");
		expect(body.value.id).toBe(a.id);
	});

	it("returns 404 session_not_found for cross-gateway lookup", async () => {
		const b = await postSession("claude-code", {});
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions/${b.id}`);
		expect(res.status).toBe(404);
		const body = (await res.json()) as ErrorBody;
		expect(body.value.error).toBe("session_not_found");
		expect(body.value.message).toContain(b.id);
	});

	it("returns 404 session_not_found for unknown id on a known gateway", async () => {
		const res = await fetch(
			`${baseUrl}/gateways/hermes/sessions/ses_DOES_NOT_EXIST`,
		);
		expect(res.status).toBe(404);
		const body = (await res.json()) as ErrorBody;
		expect(body.value.error).toBe("session_not_found");
	});

	it("returns 404 session_not_found for ids without the ses_ prefix", async () => {
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions/not-an-id`);
		expect(res.status).toBe(404);
		const body = (await res.json()) as ErrorBody;
		expect(body.value.error).toBe("session_not_found");
	});

	it("returns 404 gateway_not_found (not session_not_found) for unknown gateway", async () => {
		const a = await postSession("hermes", {});
		const res = await fetch(
			`${baseUrl}/gateways/does-not-exist/sessions/${a.id}`,
		);
		expect(res.status).toBe(404);
		const body = (await res.json()) as ErrorBody;
		expect(body.value.error).toBe("gateway_not_found");
	});

	it("returns 405 with Allow: GET, DELETE on PATCH", async () => {
		const a = await postSession("hermes", {});
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions/${a.id}`, {
			method: "PATCH",
		});
		expect(res.status).toBe(405);
		expect(res.headers.get("allow")).toBe("GET, DELETE");
	});

	it("treats trailing slash equivalently", async () => {
		const a = await postSession("hermes", {});
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions/${a.id}/`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { value: SessionValue };
		expect(body.value.id).toBe(a.id);
	});

	it("session ids are case-sensitive", async () => {
		const a = await postSession("hermes", {});
		const lower = a.id.toLowerCase();
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions/${lower}`);
		expect(res.status).toBe(404);
		const body = (await res.json()) as ErrorBody;
		expect(body.value.error).toBe("session_not_found");
	});
});

describe("@sumeru/server — DELETE /gateways/:name/sessions/:id", () => {
	let server: StartedServer;
	let baseUrl: string;

	beforeEach(async () => {
		const ctx = await startTestServer();
		server = ctx.server;
		baseUrl = ctx.baseUrl;
	});

	afterEach(async () => {
		await server.stop();
	});

	async function postSession(
		gateway: string,
		body: unknown = {},
	): Promise<SessionValue> {
		const res = await fetch(`${baseUrl}/gateways/${gateway}/sessions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
		const parsed = (await res.json()) as { value: SessionValue };
		return parsed.value;
	}

	it("returns 204 with no body on first close", async () => {
		const a = await postSession("hermes", {});
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions/${a.id}`, {
			method: "DELETE",
		});
		expect(res.status).toBe(204);
		const text = await res.text();
		expect(text).toBe("");
	});

	it("post-close detail returns 200 with status=closed and original config", async () => {
		const a = await postSession("hermes", { config: { model: "x" } });
		await fetch(`${baseUrl}/gateways/hermes/sessions/${a.id}`, {
			method: "DELETE",
		});
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions/${a.id}`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { value: SessionValue };
		expect(body.value.status).toBe("closed");
		expect(body.value.config).toEqual({ model: "x" });
	});

	it("re-closing a closed session is idempotent (204)", async () => {
		const a = await postSession("hermes", {});
		const first = await fetch(`${baseUrl}/gateways/hermes/sessions/${a.id}`, {
			method: "DELETE",
		});
		expect(first.status).toBe(204);
		const second = await fetch(`${baseUrl}/gateways/hermes/sessions/${a.id}`, {
			method: "DELETE",
		});
		expect(second.status).toBe(204);
	});

	it("returns 404 session_not_found for unknown session", async () => {
		const res = await fetch(
			`${baseUrl}/gateways/hermes/sessions/ses_DOES_NOT_EXIST`,
			{ method: "DELETE" },
		);
		expect(res.status).toBe(404);
		const body = (await res.json()) as ErrorBody;
		expect(body.value.error).toBe("session_not_found");
	});

	it("returns 404 gateway_not_found for unknown gateway", async () => {
		const a = await postSession("hermes", {});
		const res = await fetch(
			`${baseUrl}/gateways/does-not-exist/sessions/${a.id}`,
			{ method: "DELETE" },
		);
		expect(res.status).toBe(404);
		const body = (await res.json()) as ErrorBody;
		expect(body.value.error).toBe("gateway_not_found");
	});

	it("decrements activeSessions on the gateway counter", async () => {
		const a = await postSession("hermes", {});
		await postSession("hermes", {});
		const before = await fetch(`${baseUrl}/gateways/hermes`);
		const beforeBody = (await before.json()) as {
			value: { activeSessions: number };
		};
		expect(beforeBody.value.activeSessions).toBe(2);
		await fetch(`${baseUrl}/gateways/hermes/sessions/${a.id}`, {
			method: "DELETE",
		});
		const after = await fetch(`${baseUrl}/gateways/hermes`);
		const afterBody = (await after.json()) as {
			value: { activeSessions: number };
		};
		expect(afterBody.value.activeSessions).toBe(1);
	});

	it("post-close listing still includes the entry as closed", async () => {
		const a = await postSession("hermes", {});
		await fetch(`${baseUrl}/gateways/hermes/sessions/${a.id}`, {
			method: "DELETE",
		});
		const res = await fetch(`${baseUrl}/gateways/hermes/sessions`);
		const body = (await res.json()) as {
			value: SessionListEntryShape[];
		};
		expect(body.value.map((s) => s.id)).toEqual([a.id]);
		expect(body.value[0]?.status).toBe("closed");
	});
});

describe("@sumeru/server — gateway counters reflect non-closed sessions", () => {
	let server: StartedServer;
	let baseUrl: string;

	beforeEach(async () => {
		const ctx = await startTestServer();
		server = ctx.server;
		baseUrl = ctx.baseUrl;
	});

	afterEach(async () => {
		await server.stop();
	});

	it("reports activeSessions in GET /gateways list", async () => {
		await fetch(`${baseUrl}/gateways/hermes/sessions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		await fetch(`${baseUrl}/gateways/hermes/sessions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		await fetch(`${baseUrl}/gateways/claude-code/sessions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{}",
		});
		const res = await fetch(`${baseUrl}/gateways`);
		const body = (await res.json()) as {
			value: Array<{ name: string; activeSessions: number }>;
		};
		const hermes = body.value.find((g) => g.name === "hermes");
		const cc = body.value.find((g) => g.name === "claude-code");
		expect(hermes?.activeSessions).toBe(2);
		expect(cc?.activeSessions).toBe(1);
	});
});
