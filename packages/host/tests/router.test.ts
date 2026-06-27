import { describe, expect, it } from "vitest";
import { createRouter } from "../src/router.js";

function createTestRouter() {
	return createRouter({
		methodNotAllowed: () => {},
		notFound: () => {},
	});
}

describe("router — host routes", () => {
	it("matches GET /", () => {
		const router = createTestRouter();
		router.route("GET", "/", () => {});
		const result = router.match("GET", "/");
		expect(result.type).toBe("match");
	});

	it("matches GET /prototypes/:name", () => {
		const router = createTestRouter();
		router.route("GET", "/prototypes/:name", () => {});
		const result = router.match("GET", "/prototypes/claude-code");
		expect(result.type).toBe("match");
		if (result.type === "match") {
			expect(result.params).toEqual({ name: "claude-code" });
		}
	});

	it("matches POST /instances/:id/inbox", () => {
		const router = createTestRouter();
		router.route("POST", "/instances/:id/inbox", () => {});
		const result = router.match("POST", "/instances/inst_01J/inbox");
		expect(result.type).toBe("match");
		if (result.type === "match") {
			expect(result.params).toEqual({ id: "inst_01J" });
		}
	});

	it("matches GET /instances/:id/outbox", () => {
		const router = createTestRouter();
		router.route("GET", "/instances/:id/outbox", () => {});
		const result = router.match("GET", "/instances/inst_01J/outbox");
		expect(result.type).toBe("match");
	});

	it("matches GET /instances/:id/history", () => {
		const router = createTestRouter();
		router.route("GET", "/instances/:id/history", () => {});
		const result = router.match("GET", "/instances/inst_01J/history");
		expect(result.type).toBe("match");
		if (result.type === "match") {
			expect(result.params).toEqual({ id: "inst_01J" });
		}
	});

	it("returns method_not_allowed for wrong verb on inbox", () => {
		const router = createTestRouter();
		router.route("POST", "/instances/:id/inbox", () => {});
		const result = router.match("GET", "/instances/inst_01J/inbox");
		expect(result.type).toBe("method_not_allowed");
		if (result.type === "method_not_allowed") {
			expect(result.allow).toBe("POST");
		}
	});

	it("normalizes trailing slashes", () => {
		const router = createTestRouter();
		router.route("GET", "/instances", () => {});
		const result = router.match("GET", "/instances/");
		expect(result.type).toBe("match");
	});

	it("returns not_found for unknown paths", () => {
		const router = createTestRouter();
		router.route("GET", "/instances", () => {});
		const result = router.match("GET", "/unknown");
		expect(result.type).toBe("not_found");
	});
});
