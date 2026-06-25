#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCLI } from "@ocas/cli-kit";
import { type GatewayConfig, loadConfig, startServer } from "@sumeru/server";
import { z } from "zod";
import { buildAdapters } from "./build-adapters.js";
import {
	isProcessAlive,
	readPidFile,
	removePidFile,
	resolvePidFilePath,
	writePidFile,
} from "./pid-file.js";
import { formatPortInUse, killHolder, lookupPortHolder } from "./port-check.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(
	readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
) as { version: string };
const VERSION = pkg.version;

// --- Schemas ---

const notImplementedSchema = z.object({
	command: z.string(),
	status: z.literal("not_implemented"),
});

const startResultSchema = z.object({
	url: z.string(),
	host: z.string(),
	port: z.number(),
	status: z.literal("started"),
});

// --- Build CLI ---

const cli = createCLI({
	name: "sumeru",
	version: VERSION,
});

// start [--port] [--host] [--config] [--ocas-dir] [--force]
cli
	.command("start")
	.flag("port", { type: "number", default: 7900 })
	.flag("host", { type: "string", default: "127.0.0.1" })
	.flag("config", { type: "string" })
	.flag("ocas-dir", { type: "string" })
	.flag("force", { type: "boolean", default: false })
	.returns(startResultSchema, "Listening on {{ url }}")
	.action(async (_args, flags, ctx) => {
		const port = flags.port as number;
		const host = flags.host as string;
		const force = flags.force as boolean;
		const configPath = (flags.config as string | undefined) ?? null;
		const ocasDirRaw = flags["ocas-dir"] as string | undefined;
		const ocasDir =
			typeof ocasDirRaw === "string" && ocasDirRaw.length > 0
				? ocasDirRaw
				: null;

		// Load config (if any) BEFORE binding a port
		let name = "sumeru";
		let gateways: Record<string, GatewayConfig> = {};
		let workspaceRoot: string | null = null;
		if (configPath !== null) {
			try {
				const cfg = await loadConfig(configPath);
				name = cfg.name;
				gateways = cfg.gateways;
				workspaceRoot = cfg.workspaceRoot;
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.error(`Failed to load config from ${configPath}: ${msg}`);
			}
		}

		// --- PID file lifecycle (issue #33) ---
		const pidFilePath = resolvePidFilePath();
		const existingPid = readPidFile(pidFilePath);
		if (existingPid !== null) {
			if (isProcessAlive(existingPid)) {
				if (force) {
					try {
						await killHolder(existingPid, port, host);
						ctx.log.info(
							"SUMERU0001",
							`killed pid ${existingPid} from stale pid file`,
						);
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						ctx.error(`Failed to kill pid ${existingPid}: ${msg}`);
					}
				} else {
					ctx.error(
						`Another sumeru appears to be running (pid ${existingPid}, recorded in ${pidFilePath}).\n  Stop it first, or run \`sumeru start … --force\` to terminate it.`,
					);
				}
			} else {
				ctx.log.info(
					"SUMERU0002",
					`removing stale pid file (pid ${existingPid} not running)`,
				);
			}
		}

		try {
			writePidFile(pidFilePath, process.pid);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			ctx.log.warn("SUMERU0003", `could not write pid file: ${msg}`);
		}

		try {
			const server = await startServerWithRetry({
				port,
				host,
				name,
				version: VERSION,
				gateways,
				workspaceRoot,
				ocasDir,
				force,
			});

			const url = `http://${server.host}:${server.port}`;

			// Block until shutdown signal
			await new Promise<void>((resolve) => {
				let shuttingDown = false;
				const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
					if (shuttingDown) {
						const code = signal === "SIGINT" ? 130 : 143;
						process.exit(code);
					}
					shuttingDown = true;
					ctx.log.info("SUMERU0004", `shutting down (${signal})...`);
					try {
						await server.stop();
						try {
							removePidFile(pidFilePath);
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							ctx.log.warn("SUMERU0005", `could not remove pid file: ${msg}`);
						}
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						ctx.log.warn("SUMERU0006", `failed to stop server: ${msg}`);
						try {
							removePidFile(pidFilePath);
						} catch {
							/* ignore on the failure path */
						}
					}
					resolve();
				};
				process.on("SIGINT", () => {
					void shutdown("SIGINT");
				});
				process.on("SIGTERM", () => {
					void shutdown("SIGTERM");
				});
			});

			return {
				url,
				host: server.host,
				port: server.port,
				status: "started" as const,
			};
		} catch (err) {
			try {
				removePidFile(pidFilePath);
			} catch {
				/* best effort */
			}
			const code =
				err instanceof Error && "code" in err
					? (err as { code: unknown }).code
					: null;
			if (code === "EADDRINUSE") {
				const holder = await lookupPortHolder(host, port);
				ctx.error(formatPortInUse({ host, port, holder }));
			} else {
				const msg = err instanceof Error ? err.message : String(err);
				ctx.error(`Failed to start server: ${msg}`);
			}
		}
	});

// run [planned]
cli
	.command("run")
	.flag("scene", { type: "string" })
	.flag("runner", { type: "string" })
	.flag("model", { type: "string" })
	.flag("timeout", { type: "number", default: 300 })
	.flag("network", { type: "boolean", default: true })
	.flag("image", { type: "string" })
	.flag("output", { type: "string" })
	.returns(notImplementedSchema, "{{ command }}: {{ status }}")
	.action(async () => {
		return { command: "run", status: "not_implemented" as const };
	});

// list [planned]
cli
	.command("list")
	.flag("dir", { type: "string", default: "scenes" })
	.returns(notImplementedSchema, "{{ command }}: {{ status }}")
	.action(async () => {
		return { command: "list", status: "not_implemented" as const };
	});

// --- Helpers ---

type StartArgs = {
	port: number;
	host: string;
	name: string;
	version: string;
	gateways: Record<string, GatewayConfig>;
	workspaceRoot: string | null;
	ocasDir: string | null;
	force: boolean;
};

async function startServerWithRetry(
	args: StartArgs,
): Promise<Awaited<ReturnType<typeof startServer>>> {
	try {
		return await startServer({
			port: args.port,
			host: args.host,
			name: args.name,
			version: args.version,
			gateways: args.gateways,
			workspaceRoot: args.workspaceRoot,
			adapters: buildAdapters(args.gateways),
			sseHeartbeatMs: null,
			sseBufferSize: null,
			sseRetentionMs: null,
			ocasDir: args.ocasDir,
		});
	} catch (err) {
		const code =
			err instanceof Error && "code" in err
				? (err as { code: unknown }).code
				: null;
		if (code !== "EADDRINUSE" || !args.force) throw err;

		const holder = await lookupPortHolder(args.host, args.port);
		if (holder === null) {
			throw err;
		}
		try {
			await killHolder(holder.pid, args.port, args.host);
		} catch (killErr) {
			const msg = killErr instanceof Error ? killErr.message : String(killErr);
			throw new Error(`Failed to kill pid ${holder.pid}: ${msg}`);
		}
		return startServer({
			port: args.port,
			host: args.host,
			name: args.name,
			version: args.version,
			gateways: args.gateways,
			workspaceRoot: args.workspaceRoot,
			adapters: buildAdapters(args.gateways),
			sseHeartbeatMs: null,
			sseBufferSize: null,
			sseRetentionMs: null,
			ocasDir: args.ocasDir,
		});
	}
}

cli.run();
