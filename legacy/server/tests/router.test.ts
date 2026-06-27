/**
 * Unit tests for the minimal declarative router.
 *
 * Tests the core matching logic directly (no HTTP server needed):
 * - Static segment matching
 * - :param extraction (single and multi)
 * - Segment-count disambiguation
 * - Empty param rejection
 * - Trailing-slash normalization
 * - Method dispatch: match, 405, 404
 * - HEAD fallback to GET
 */

import { describe, expect, it } from "vitest";
import { createAPI } from "../src/api-kit/index.js";

function createTestApi() {
	return createAPI({
		methodNotAllowed: () => {},
		notFound: () => {},
	});
}

describe("router — static matching", () => {
	it("matches root path /", () => {
		const api = createTestApi();
		api.route("GET", "/", () => {});
		const result = api.match("GET", "/");
		expect(result.type).toBe("match");
		if (result.type === "match") {
			expect(result.params).toEqual({});
		}
	});

	it("matches static path /gateways", () => {
		const api = createTestApi();
		api.route("GET", "/gateways", () => {});
		const result = api.match("GET", "/gateways");
		expect(result.type).toBe("match");
		if (result.type === "match") {
			expect(result.params).toEqual({});
		}
	});

	it("static literal mismatch returns not_found", () => {
		const api = createTestApi();
		api.route("GET", "/gateways", () => {});
		const result = api.match("GET", "/sessions");
		expect(result.type).toBe("not_found");
	});
});

describe("router — :param extraction", () => {
	it("extracts single :param", () => {
		const api = createTestApi();
		api.route("GET", "/gateways/:name", () => {});
		const result = api.match("GET", "/gateways/hermes");
		expect(result.type).toBe("match");
		if (result.type === "match") {
			expect(result.params).toEqual({ name: "hermes" });
		}
	});

	it("extracts multiple :params", () => {
		const api = createTestApi();
		api.route("GET", "/gateways/:name/sessions/:id", () => {});
		const result = api.match("GET", "/gateways/hermes/sessions/ses_01J");
		expect(result.type).toBe("match");
		if (result.type === "match") {
			expect(result.params).toEqual({ name: "hermes", id: "ses_01J" });
		}
	});

	it("preserves raw URL-encoded params (no decoding)", () => {
		const api = createTestApi();
		api.route("GET", "/gateways/:name", () => {});
		const result = api.match("GET", "/gateways/hello%20world");
		expect(result.type).toBe("match");
		if (result.type === "match") {
			expect(result.params.name).toBe("hello%20world");
		}
	});

	it("rejects empty :param segment", () => {
		const api = createTestApi();
		api.route("GET", "/gateways/:name", () => {});
		const result = api.match("GET", "/gateways/");
		expect(result.type).toBe("not_found");
	});
});

describe("router — segment-count disambiguation", () => {
	it("distinguishes /gateways/:name from /gateways/:name/sessions", () => {
		const api = createTestApi();
		let matchedRoute = "";
		api.route("GET", "/gateways/:name", () => {
			matchedRoute = "gateway-detail";
		});
		api.route("GET", "/gateways/:name/sessions", () => {
			matchedRoute = "sessions-collection";
		});

		const result1 = api.match("GET", "/gateways/hermes");
		expect(result1.type).toBe("match");
		if (result1.type === "match") {
			result1.handler({} as never, {} as never, result1.params, "", "");
			expect(matchedRoute).toBe("gateway-detail");
		}

		const result2 = api.match("GET", "/gateways/hermes/sessions");
		expect(result2.type).toBe("match");
		if (result2.type === "match") {
			result2.handler({} as never, {} as never, result2.params, "", "");
			expect(matchedRoute).toBe("sessions-collection");
		}
	});

	it("distinguishes /sessions/:id from /sessions/:id/messages by segment count", () => {
		const api = createTestApi();
		api.route("GET", "/gateways/:g/sessions/:id", () => {});
		api.route("GET", "/gateways/:g/sessions/:id/messages", () => {});

		const sessionResult = api.match("GET", "/gateways/g/sessions/s");
		expect(sessionResult.type).toBe("match");
		if (sessionResult.type === "match") {
			expect(sessionResult.params).toEqual({ g: "g", id: "s" });
		}

		const msgResult = api.match("GET", "/gateways/g/sessions/s/messages");
		expect(msgResult.type).toBe("match");
		if (msgResult.type === "match") {
			expect(msgResult.params).toEqual({ g: "g", id: "s" });
		}
	});
});

describe("router — trailing-slash normalization", () => {
	it("strips trailing slash from /gateways/", () => {
		const api = createTestApi();
		api.route("GET", "/gateways", () => {});
		const result = api.match("GET", "/gateways/");
		expect(result.type).toBe("match");
	});

	it("strips trailing slash from /gateways/hermes/", () => {
		const api = createTestApi();
		api.route("GET", "/gateways/:name", () => {});
		const result = api.match("GET", "/gateways/hermes/");
		expect(result.type).toBe("match");
		if (result.type === "match") {
			expect(result.params.name).toBe("hermes");
		}
	});

	it("preserves root / as-is", () => {
		const api = createTestApi();
		api.route("GET", "/", () => {});
		const result = api.match("GET", "/");
		expect(result.type).toBe("match");
	});

	it("handles deep path with trailing slash", () => {
		const api = createTestApi();
		api.route("GET", "/gateways/:name/sessions/:id/export", () => {});
		const result = api.match("GET", "/gateways/g/sessions/s/export/");
		expect(result.type).toBe("match");
		if (result.type === "match") {
			expect(result.params).toEqual({ name: "g", id: "s" });
		}
	});
});

describe("router — method dispatch", () => {
	it("returns 405 when path matches but method does not", () => {
		const api = createTestApi();
		api.route("GET", "/", () => {});
		const result = api.match("POST", "/");
		expect(result.type).toBe("method_not_allowed");
		if (result.type === "method_not_allowed") {
			expect(result.allow).toBe("GET");
		}
	});

	it("returns 404 when no path matches", () => {
		const api = createTestApi();
		api.route("GET", "/", () => {});
		const result = api.match("GET", "/nonexistent");
		expect(result.type).toBe("not_found");
	});

	it("collects all allowed methods for 405", () => {
		const api = createTestApi();
		api.route("GET", "/resource", () => {});
		api.route("POST", "/resource", () => {});
		const result = api.match("DELETE", "/resource");
		expect(result.type).toBe("method_not_allowed");
		if (result.type === "method_not_allowed") {
			expect(result.allow).toBe("GET, POST");
		}
	});

	it("wildcard method * matches any method", () => {
		const api = createTestApi();
		api.route("*", "/resource", () => {});
		expect(api.match("GET", "/resource").type).toBe("match");
		expect(api.match("POST", "/resource").type).toBe("match");
		expect(api.match("DELETE", "/resource").type).toBe("match");
		expect(api.match("PATCH", "/resource").type).toBe("match");
	});
});

describe("router — HEAD fallback to GET", () => {
	it("HEAD request matches GET route", () => {
		const api = createTestApi();
		api.route("GET", "/sessions", () => {});
		const result = api.match("HEAD", "/sessions");
		expect(result.type).toBe("match");
	});

	it("HEAD does not match POST-only route", () => {
		const api = createTestApi();
		api.route("POST", "/export", () => {});
		const result = api.match("HEAD", "/export");
		expect(result.type).toBe("method_not_allowed");
		if (result.type === "method_not_allowed") {
			expect(result.allow).toBe("POST");
		}
	});

	it("HEAD fallback preserves correct Allow header (GET only)", () => {
		const api = createTestApi();
		api.route("GET", "/ocas/:hash", () => {});
		const headResult = api.match("HEAD", "/ocas/ABC123");
		expect(headResult.type).toBe("match");

		const postResult = api.match("POST", "/ocas/ABC123");
		expect(postResult.type).toBe("method_not_allowed");
		if (postResult.type === "method_not_allowed") {
			expect(postResult.allow).toBe("GET");
		}
	});
});

describe("router — static literal precedence", () => {
	it("static segment must match exactly (sessions vs widgets)", () => {
		const api = createTestApi();
		api.route("GET", "/gateways/:name/sessions/:id", () => {});
		const result = api.match("GET", "/gateways/g/widgets/s");
		expect(result.type).toBe("not_found");
	});

	it("different tail literals (messages vs export) are distinct", () => {
		const api = createTestApi();
		let matched = "";
		api.route("GET", "/gateways/:n/sessions/:id/messages", () => {
			matched = "messages";
		});
		api.route("GET", "/gateways/:n/sessions/:id/export", () => {
			matched = "export";
		});

		const msgResult = api.match("GET", "/gateways/g/sessions/s/messages");
		expect(msgResult.type).toBe("match");
		if (msgResult.type === "match") {
			msgResult.handler({} as never, {} as never, {}, "", "");
			expect(matched).toBe("messages");
		}

		const expResult = api.match("GET", "/gateways/g/sessions/s/export");
		expect(expResult.type).toBe("match");
		if (expResult.type === "match") {
			expResult.handler({} as never, {} as never, {}, "", "");
			expect(matched).toBe("export");
		}
	});
});
