import { createServer as createHttpServer } from "node:http";
import { createHandler } from "./handler.js";
import type { StartConfig, StartedServer } from "./types.js";

/**
 * Start an HTTP listener bound to `host:port`.
 *
 * - `port: 0` lets the OS pick a free port; the actual port is returned.
 * - Listens on the IPv4 loopback by default (Phase 0 — local only).
 * - Returns a `stop()` function that closes the listener.
 */
export function startServer(config: StartConfig): Promise<StartedServer> {
	const handler = createHandler({ name: config.name, version: config.version });
	const server = createHttpServer(handler);

	return new Promise<StartedServer>((resolve, reject) => {
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
			resolve({
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
