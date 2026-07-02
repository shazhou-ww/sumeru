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

	it("matches POST /sessions/:id/messages", () => {
		const router = createTestRouter();
		router.route("POST", "/sessions/:id/messages", () => {});
		const result = router.match("POST", "/sessions/ses_01J/messages");
		expect(result.type).toBe("match");
		if (result.type === "match") {
			expect(result.params).toEqual({ id: "ses_01J" });
		}
	});

	it("matches GET /sessions/:id/events", () => {
		const router = createTestRouter();
		router.route("GET", "/sessions/:id/events", () => {});
		const result = router.match("GET", "/sessions/ses_01J/events");
		expect(result.type).toBe("match");
	});

	it("matches GET /sessions/:id/history", () => {
		const router = createTestRouter();
		router.route("GET", "/sessions/:id/history", () => {});
		const result = router.match("GET", "/sessions/ses_01J/history");
		expect(result.type).toBe("match");
		if (result.type === "match") {
			expect(result.params).toEqual({ id: "ses_01J" });
		}
	});

	it("matches GET /sessions/:id/turns", () => {
		const router = createTestRouter();
		router.route("GET", "/sessions/:id/turns", () => {});
		const result = router.match("GET", "/sessions/ses_01J/turns");
		expect(result.type).toBe("match");
		if (result.type === "match") {
			expect(result.params).toEqual({ id: "ses_01J" });
		}
	});

	it("returns method_not_allowed for wrong verb on messages", () => {
		const router = createTestRouter();
		router.route("POST", "/sessions/:id/messages", () => {});
		const result = router.match("GET", "/sessions/ses_01J/messages");
		expect(result.type).toBe("method_not_allowed");
		if (result.type === "method_not_allowed") {
			expect(result.allow).toBe("POST");
		}
	});

	it("normalizes trailing slashes", () => {
		const router = createTestRouter();
		router.route("GET", "/sessions", () => {});
		const result = router.match("GET", "/sessions/");
		expect(result.type).toBe("match");
	});

	it("returns not_found for unknown paths", () => {
		const router = createTestRouter();
		router.route("GET", "/sessions", () => {});
		const result = router.match("GET", "/unknown");
		expect(result.type).toBe("not_found");
	});
});
