/**
 * Phase 5 — session export.
 *
 * Builds a self-contained `tar.gz` from a session's recording (session-meta
 * + every turn + their schema chain) using `@ocas/core.exportBundle`. The
 * resulting bundle can be re-imported into another ocas store via
 * `importBundle` to reproduce the recording bit-for-bit.
 */

import { createReadStream, mkdtempSync, statSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { exportBundle } from "@ocas/core";
import type { OcasConfig, Session } from "../types.js";

/**
 * Build a session export tar.gz on disk and return its path + node count.
 *
 * Caller is responsible for cleaning up the returned `tempDir`.
 */
export async function buildSessionExport(
	session: Session,
	ocas: OcasConfig,
): Promise<{
	tarGzPath: string;
	tempDir: string;
	nodes: number;
}> {
	const tempDir = mkdtempSync(join(tmpdir(), "sumeru-export-"));
	const tarPath = join(tempDir, "bundle.tar");
	const tarGzPath = `${tarPath}.gz`;

	const roots = [session.metaHash, ...session.turnHashes];
	const stats = await exportBundle(ocas.store, roots, tarPath);

	const tarBytes = await readFile(tarPath);
	const gzBytes = gzipSync(tarBytes, { level: 6 });
	await writeFile(tarGzPath, gzBytes);

	return { tarGzPath, tempDir, nodes: stats.nodes };
}

/**
 * Stream a previously-built tar.gz to an HTTP response with the spec headers.
 *
 * The temp dir is removed after the response `finish` (or `close`) event so
 * concurrent exports never leak.
 */
export async function streamExportResponse(
	res: ServerResponse,
	sessionId: string,
	tarGzPath: string,
	tempDir: string,
	nodes: number,
	method: "POST" | "HEAD",
): Promise<void> {
	const size = statSync(tarGzPath).size;
	res.statusCode = 200;
	res.setHeader("Content-Type", "application/gzip");
	res.setHeader(
		"Content-Disposition",
		`attachment; filename="${sessionId}.tar.gz"`,
	);
	res.setHeader("Cache-Control", "no-store");
	res.setHeader("X-Sumeru-Export-Nodes", nodes.toString());
	res.setHeader("X-Sumeru-Export-Session", sessionId);
	res.setHeader("Content-Length", size.toString());

	const cleanup = async (): Promise<void> => {
		try {
			await rm(tempDir, { recursive: true, force: true });
		} catch {
			// Best-effort.
		}
	};
	res.once("close", () => {
		void cleanup();
	});

	if (method === "HEAD") {
		res.end();
		await cleanup();
		return;
	}

	await new Promise<void>((resolve) => {
		const stream = createReadStream(tarGzPath);
		stream.on("error", () => {
			res.end();
			resolve();
		});
		res.on("finish", () => {
			resolve();
		});
		res.on("close", () => {
			resolve();
		});
		stream.pipe(res);
	});
	await cleanup();
}
