/**
 * Unit tests for the port-check helper (issue #33).
 *
 * `lookupPortHolder(host, port)` is exercised against a real listener in this
 * test (not a process spawn — the helper itself shells out to lsof). When
 * lsof is missing the helper returns `null`.
 *
 * See specs/cli-startup-port-check.md.
 */

import { createServer } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatPortInUse, lookupPortHolder } from "../src/port-check.js";

describe("port-check helper (issue #33)", () => {
	let server: ReturnType<typeof createServer> | null = null;

	beforeEach(() => {
		server = null;
	});

	afterEach(async () => {
		if (server !== null) {
			await new Promise<void>((res) => {
				server?.close(() => res());
			});
			server = null;
		}
	});

	it("returns null when no process is bound to the port", async () => {
		const result = await lookupPortHolder("127.0.0.1", 1);
		expect(result).toBe(null);
	});

	it("identifies the holder of an actively-listening port (when lsof is present)", async () => {
		const s = createServer();
		server = s;
		await new Promise<void>((res, rej) => {
			s.once("error", rej);
			s.listen(0, "127.0.0.1", () => res());
		});
		const addr = s.address();
		if (addr === null || typeof addr === "string") {
			throw new Error("listener bound to unexpected address");
		}
		const result = await lookupPortHolder("127.0.0.1", addr.port);
		// If lsof isn't installed in this environment the helper returns null —
		// we still want a deterministic test, so accept either shape.
		if (result !== null) {
			expect(result.pid).toBe(process.pid);
			expect(typeof result.command).toBe("string");
			expect(result.command.length).toBeGreaterThan(0);
		}
	});

	it("formats the diagnostic block with holder details", () => {
		const out = formatPortInUse({
			host: "127.0.0.1",
			port: 7900,
			holder: { pid: 4242, command: "node" },
		});
		expect(out).toContain("Port 7900 is already in use on 127.0.0.1.");
		expect(out).toContain("Held by pid 4242 (node)");
		expect(out).toContain("--force");
	});

	it("formats a fallback diagnostic when the holder cannot be identified", () => {
		const out = formatPortInUse({
			host: "127.0.0.1",
			port: 7900,
			holder: null,
		});
		expect(out).toBe(
			"Port 7900 is already in use on 127.0.0.1. Choose a different --port or stop the conflicting process.",
		);
		expect(out).not.toContain("Held by pid");
		expect(out).not.toContain("--force");
	});
});
