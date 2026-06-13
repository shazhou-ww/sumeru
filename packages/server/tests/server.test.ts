import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { StartedServer } from "../src/index.js";
import { startServer } from "../src/index.js";

describe("@sumeru/server — instance endpoint", () => {
	let server: StartedServer;
	let baseUrl: string;

	beforeEach(async () => {
		server = await startServer({
			port: 0,
			host: "127.0.0.1",
			name: "sumeru",
			version: "0.1.0",
			gateways: {},
		});
		baseUrl = `http://${server.host}:${server.port}`;
	});

	afterEach(async () => {
		await server.stop();
	});

	it("returns 200 with the @sumeru/instance envelope on GET /", async () => {
		const res = await fetch(`${baseUrl}/`);
		expect(res.status).toBe(200);
		expect(res.headers.get("content-type") ?? "").toMatch(/^application\/json/);

		const body = (await res.json()) as unknown;
		expect(body).toEqual({
			type: "@sumeru/instance",
			value: {
				name: "sumeru",
				version: "0.1.0",
				gateways: [],
			},
		});
	});

	it("envelope has exactly two top-level keys: type and value", async () => {
		const res = await fetch(`${baseUrl}/`);
		const body = (await res.json()) as Record<string, unknown>;
		expect(Object.keys(body).sort()).toEqual(["type", "value"]);
	});

	it("value.gateways is always an array, never null", async () => {
		const res = await fetch(`${baseUrl}/`);
		const body = (await res.json()) as { value: { gateways: unknown } };
		expect(Array.isArray(body.value.gateways)).toBe(true);
	});

	it("returns 404 envelope on unknown GET path", async () => {
		const res = await fetch(`${baseUrl}/does-not-exist`);
		expect(res.status).toBe(404);
		expect(res.headers.get("content-type") ?? "").toMatch(/^application\/json/);

		const body = (await res.json()) as {
			type: string;
			value: { error: string; message: string };
		};
		expect(body.type).toBe("@sumeru/error");
		expect(body.value.error).toBe("not_found");
		expect(typeof body.value.message).toBe("string");
	});

	it("returns 405 with Allow: GET on POST /", async () => {
		const res = await fetch(`${baseUrl}/`, { method: "POST" });
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

describe("@sumeru/server — startServer", () => {
	it("binds an ephemeral port when port=0", async () => {
		const s = await startServer({
			port: 0,
			host: "127.0.0.1",
			name: "sumeru",
			version: "0.1.0",
			gateways: {},
		});
		try {
			expect(s.port).toBeGreaterThan(0);
			expect(s.host).toBe("127.0.0.1");
		} finally {
			await s.stop();
		}
	});

	it("rejects when the chosen port is already in use", async () => {
		const first = await startServer({
			port: 0,
			host: "127.0.0.1",
			name: "sumeru",
			version: "0.1.0",
			gateways: {},
		});
		try {
			await expect(
				startServer({
					port: first.port,
					host: "127.0.0.1",
					name: "sumeru",
					version: "0.1.0",
					gateways: {},
				}),
			).rejects.toThrow();
		} finally {
			await first.stop();
		}
	});
});
