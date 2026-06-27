import { describe, expect, it } from "vitest";
import { resolveSessionCwd } from "../src/index.js";

const ROOT = "/tmp/sumeru-ws";

describe("resolveSessionCwd — workspaceRoot configured", () => {
	it("relative single-segment cwd resolves under root", () => {
		const r = resolveSessionCwd(ROOT, "project-a");
		expect(r).toEqual({ ok: true, cwd: "/tmp/sumeru-ws/project-a" });
	});

	it("relative multi-segment cwd resolves under root", () => {
		const r = resolveSessionCwd(ROOT, "team/project-b");
		expect(r).toEqual({ ok: true, cwd: "/tmp/sumeru-ws/team/project-b" });
	});

	it("absolute cwd inside root is accepted", () => {
		const r = resolveSessionCwd(ROOT, "/tmp/sumeru-ws/abs-project");
		expect(r).toEqual({ ok: true, cwd: "/tmp/sumeru-ws/abs-project" });
	});

	it("absolute cwd at exactly root is accepted", () => {
		const r = resolveSessionCwd(ROOT, "/tmp/sumeru-ws");
		expect(r).toEqual({ ok: true, cwd: "/tmp/sumeru-ws" });
	});

	it("relative path that escapes root via .. is rejected", () => {
		const r = resolveSessionCwd(ROOT, "../escape");
		expect(r.ok).toBe(false);
		if (r.ok === false) {
			expect(r.message).toMatch(/resolves outside workspaceRoot/);
			expect(r.message).toContain("../escape");
		}
	});

	it("absolute cwd outside root is rejected", () => {
		const r = resolveSessionCwd(ROOT, "/etc/passwd");
		expect(r.ok).toBe(false);
		if (r.ok === false) {
			expect(r.message).toMatch(/resolves outside workspaceRoot/);
		}
	});

	it("path that is a sibling prefix of root is rejected", () => {
		// "/tmp/sumeru-ws-evil" startsWith("/tmp/sumeru-ws") but not the root
		// directory itself — the check uses `+ sep` to avoid this trap.
		const r = resolveSessionCwd(ROOT, "/tmp/sumeru-ws-evil/inside");
		expect(r.ok).toBe(false);
	});
});

describe("resolveSessionCwd — workspaceRoot null", () => {
	it("absolute cwd is returned verbatim", () => {
		const r = resolveSessionCwd(null, "/tmp/sumeru-ws/abs-project");
		expect(r).toEqual({ ok: true, cwd: "/tmp/sumeru-ws/abs-project" });
	});

	it("relative cwd is rejected", () => {
		const r = resolveSessionCwd(null, "project-a");
		expect(r.ok).toBe(false);
		if (r.ok === false) {
			expect(r.message).toMatch(/must be absolute when no workspaceRoot/);
		}
	});

	it("relative .. cwd is rejected", () => {
		const r = resolveSessionCwd(null, "../escape");
		expect(r.ok).toBe(false);
	});
});

describe("resolveSessionCwd — absent / empty / wrong type", () => {
	it("undefined raw cwd → null (with root)", () => {
		expect(resolveSessionCwd(ROOT, undefined)).toEqual({ ok: true, cwd: null });
	});

	it("undefined raw cwd → null (without root)", () => {
		expect(resolveSessionCwd(null, undefined)).toEqual({ ok: true, cwd: null });
	});

	it("explicit null raw cwd → null", () => {
		expect(resolveSessionCwd(ROOT, null)).toEqual({ ok: true, cwd: null });
	});

	it("empty string raw cwd → null", () => {
		expect(resolveSessionCwd(ROOT, "")).toEqual({ ok: true, cwd: null });
	});

	it("number raw cwd → invalid_cwd", () => {
		const r = resolveSessionCwd(ROOT, 42);
		expect(r.ok).toBe(false);
		if (r.ok === false) {
			expect(r.message).toBe("config.cwd must be a string");
		}
	});

	it("boolean raw cwd → invalid_cwd", () => {
		const r = resolveSessionCwd(null, true);
		expect(r.ok).toBe(false);
	});

	it("object raw cwd → invalid_cwd", () => {
		const r = resolveSessionCwd(ROOT, { not: "a string" });
		expect(r.ok).toBe(false);
	});
});
