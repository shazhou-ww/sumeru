import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { computeHash } from "../src/package-hasher.js";

function writePkg(root: string, files: Record<string, string>): void {
	for (const [rel, content] of Object.entries(files)) {
		const full = join(root, rel);
		mkdirSync(join(full, ".."), { recursive: true });
		writeFileSync(full, content);
	}
}

describe("computeHash", () => {
	it("returns a 6-char hex string", async () => {
		const root = mkdtempSync(join(tmpdir(), "pkg-hash-"));
		writePkg(root, {
			"package.json": '{"name":"demo"}',
			"sumeru-adapter.yaml": "name: demo\n",
		});
		const hash = await computeHash(root);
		expect(hash).toMatch(/^[a-f0-9]{6}$/);
	});

	it("is deterministic for the same contents", async () => {
		const root = mkdtempSync(join(tmpdir(), "pkg-hash-"));
		writePkg(root, {
			"a.txt": "hello",
			"b/c.txt": "world",
		});
		const first = await computeHash(root);
		const second = await computeHash(root);
		expect(first).toBe(second);
	});

	it("is independent of filesystem entry order (sorted by path)", async () => {
		const rootA = mkdtempSync(join(tmpdir(), "pkg-hash-a-"));
		const rootB = mkdtempSync(join(tmpdir(), "pkg-hash-b-"));
		// Same files written in opposite order
		writePkg(rootA, { "z.txt": "z", "a.txt": "a", "m/n.txt": "mn" });
		writePkg(rootB, { "a.txt": "a", "m/n.txt": "mn", "z.txt": "z" });
		expect(await computeHash(rootA)).toBe(await computeHash(rootB));
	});

	it("changes when a tracked file changes", async () => {
		const root = mkdtempSync(join(tmpdir(), "pkg-hash-"));
		writePkg(root, { "a.txt": "hello" });
		const before = await computeHash(root);
		writeFileSync(join(root, "a.txt"), "hello!");
		const after = await computeHash(root);
		expect(after).not.toBe(before);
	});

	it("excludes node_modules, .git, dist, .turbo, .next, coverage, and *.log", async () => {
		const root = mkdtempSync(join(tmpdir(), "pkg-hash-"));
		writePkg(root, {
			"src/index.ts": "export {}",
			"node_modules/pkg/index.js": "ignored",
			".git/config": "ignored",
			"dist/main.js": "ignored",
			".turbo/cache.json": "ignored",
			".next/build-manifest.json": "ignored",
			"coverage/lcov.info": "ignored",
			"debug.log": "ignored",
			"logs/app.log": "ignored",
		});
		const withIgnored = await computeHash(root);

		const clean = mkdtempSync(join(tmpdir(), "pkg-hash-clean-"));
		writePkg(clean, { "src/index.ts": "export {}" });
		const withoutIgnored = await computeHash(clean);

		expect(withIgnored).toBe(withoutIgnored);
	});

	it("skips symlinks", async () => {
		const root = mkdtempSync(join(tmpdir(), "pkg-hash-"));
		writePkg(root, { "real.txt": "tracked" });
		const outside = mkdtempSync(join(tmpdir(), "pkg-hash-outside-"));
		writeFileSync(join(outside, "secret.txt"), "should-not-affect-hash");
		symlinkSync(join(outside, "secret.txt"), join(root, "link.txt"));

		const withLink = await computeHash(root);

		const clean = mkdtempSync(join(tmpdir(), "pkg-hash-nolink-"));
		writePkg(clean, { "real.txt": "tracked" });
		expect(withLink).toBe(await computeHash(clean));
	});
});
