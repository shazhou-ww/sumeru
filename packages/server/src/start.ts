import { createServer as createHttpServer } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createHandler } from "./handler.js";
import { openSumeruOcas } from "./ocas/index.js";
import type { StartConfig, StartedServer } from "./types.js";

/**
 * Resolve the ocas store directory:
 *
 *   --ocas-dir (CLI / explicit StartConfig field)  >  $SUMERU_OCAS_DIR  >  ~/.sumeru/ocas
 *
 * `~` is expanded against `os.homedir()`. The returned path is absolute.
 */
export function resolveOcasDir(explicit: string | null): string {
	const fromEnv = process.env.SUMERU_OCAS_DIR;
	const raw =
		explicit !== null && explicit.length > 0
			? explicit
			: fromEnv !== undefined && fromEnv.length > 0
				? fromEnv
				: join(homedir(), ".sumeru", "ocas");
	const expanded = raw.startsWith("~/") ? join(homedir(), raw.slice(2)) : raw;
	return resolve(expanded);
}

/**
 * Start an HTTP listener bound to `host:port`.
 *
 * - `port: 0` lets the OS pick a free port; the actual port is returned.
 * - Listens on the IPv4 loopback by default (Phase 0 — local only).
 * - Returns a `stop()` function that closes the listener.
 *
 * Phase 4: opens the ocas content-addressed store before the listener binds.
 * Filesystem errors (EACCES, ENOSPC, EROFS, …) reject the promise and the
 * HTTP listener is NOT started.
 */
export async function startServer(config: StartConfig): Promise<StartedServer> {
	const ocasDir = resolveOcasDir(config.ocasDir);
	const ocas = openSumeruOcas(ocasDir);
	console.log(`[sumeru] ocas store: ${ocasDir}`);

	const handler = createHandler({
		name: config.name,
		version: config.version,
		gateways: config.gateways,
		workspaceRoot: config.workspaceRoot,
		adapters: config.adapters ?? {},
		sseHeartbeatMs: config.sseHeartbeatMs ?? 15_000,
		sseBufferSize: config.sseBufferSize ?? 1024,
		sseRetentionMs: config.sseRetentionMs ?? 30_000,
		ocas,
	});
	const server = createHttpServer(handler);

	return new Promise<StartedServer>((resolveServer, reject) => {
		const onError = (err: Error): void => {
			server.removeListener("listening", onListening);
			reject(err);
		};

		const onListening = (): void => {
			server.removeListener("error", onError);
			const address = server.address();
			if (address === null || typeof address === "string") {
				reject(new Error("Server bound to an unexpected address"));
				return;
			}
			resolveServer({
				host: config.host,
				port: address.port,
				stop: () =>
					new Promise<void>((res, rej) => {
						server.close((err) => {
							if (err) rej(err);
							else res();
						});
					}),
			});
		};

		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(config.port, config.host);
	});
}
