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

process.on("SIGINT", () => {
	void started.stop().then(() => {
		process.exit(0);
	});
});
