#!/usr/bin/env node
import { resolve } from "node:path";
import { startHost } from "./server.js";

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
