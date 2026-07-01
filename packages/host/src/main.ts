#!/usr/bin/env node
import { resolve } from "node:path";
import { installUnhandledRejectionGuard } from "./process-guards.js";
import { startHost } from "./server.js";

// Last line of defense (issue #177): a rejected fire-and-forget background task
// (e.g. the detached readAdapterOutput loop) must never tear down the host and
// leave HTTP clients with `Connection refused`. Log the reason, keep serving.
installUnhandledRejectionGuard();

const rootDir = resolve(process.argv[2] ?? process.cwd());
const host = process.env.SUMERU_HOST ?? "127.0.0.1";
const port = Number(process.env.SUMERU_PORT ?? "7900");

const started = await startHost({ rootDir, host, port, transport: null });
console.log(`Listening on http://${started.host}:${started.port}`);

let stopping = false;
const graceful = (): void => {
	if (stopping) return;
	stopping = true;
	const timeout = setTimeout(() => {
		console.error("Graceful shutdown timed out (10s), forcing exit.");
		process.exit(1);
	}, 10_000);
	void started.stop().then(() => {
		clearTimeout(timeout);
		process.exit(0);
	});
};

process.on("SIGINT", graceful);
process.on("SIGTERM", graceful);
