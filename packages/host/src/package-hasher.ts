import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const EXCLUDED_DIR_NAMES = new Set([
	"node_modules",
	".git",
	"dist",
	".turbo",
	".next",
	"coverage",
]);

/**
 * Compute a short content hash for an adapter package directory.
 * Walks all files under `packagePath`, excluding common build/cache dirs,
 * `*.log` files, and symlinks. Returns the first 6 hex chars of the SHA-256 digest.
 */
export async function computeHash(packagePath: string): Promise<string> {
	const files = await collectFiles(packagePath);
	files.sort((a, b) => a.localeCompare(b));
	const hash = createHash("sha256");
	for (const absPath of files) {
		const rel = relative(packagePath, absPath).split(sep).join("/");
		hash.update(rel);
		hash.update("\0");
		hash.update(await readFile(absPath));
		hash.update("\0");
	}
	return hash.digest("hex").slice(0, 6);
}

/** @deprecated Prefer {@link computeHash} */
export const computePackageHash = computeHash;

async function collectFiles(dir: string): Promise<Array<string>> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: Array<string> = [];
	for (const entry of entries) {
		if (entry.isSymbolicLink()) {
			continue;
		}
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
			files.push(...(await collectFiles(fullPath)));
			continue;
		}
		if (entry.isFile()) {
			if (entry.name.endsWith(".log")) continue;
			files.push(fullPath);
		}
	}
	return files;
}
