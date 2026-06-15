#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type GatewayConfig,
	type InstanceConfig,
	loadConfig,
	startServer,
} from "@sumeru/server";
import { Command } from "commander";
import { buildAdapters } from "./build-adapters.js";
import {
	isProcessAlive,
	readPidFile,
	removePidFile,
	resolvePidFilePath,
	writePidFile,
} from "./pid-file.js";
import { formatPortInUse, killHolder, lookupPortHolder } from "./port-check.js";

function findVersion(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 5; i++) {
		try {
			const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
			if (pkg.name === "@sumeru/cli") return pkg.version ?? "0.0.0";
		} catch {
			/* keep walking */
		}
		dir = dirname(dir);
	}
	return "0.0.0";
}

const program = new Command();

program
	.name("sumeru")
	.description("Agent house — HTTP service for multi-agent management")
	.version(findVersion());

program
	.command("run")
	.description("[planned] Run a scene with a specified adapter and model")
	.requiredOption("-s, --scene <path>", "Path to scene directory or YAML")
	.requiredOption("-r, --runner <type>", "Adapter type (hermes, claude-code)")
	.requiredOption("-m, --model <model>", "Model identifier")
	.option("-t, --timeout <seconds>", "Timeout in seconds", "300")
	.option("--network", "Allow network access", true)
	.option("--no-network", "Disable network access")
	.option("-i, --image <image>", "Docker image")
	.option("-o, --output <path>", "Output path for recording")
	.action(async (opts) => {
		console.log("sumeru run — not yet implemented");
		console.log("Options:", JSON.stringify(opts, null, 2));
	});

program
	.command("list")
	.description("[planned] List available scenes")
	.option("-d, --dir <path>", "Scenes directory", "scenes")
	.action(async (opts) => {
		console.log("sumeru list — not yet implemented");
		console.log("Directory:", opts.dir);
	});

program
	.command("start")
	.description("Start the Sumeru HTTP server")
	.option("-p, --port <number>", "TCP port to bind (0 = ephemeral)", "7900")
	.option("-h, --host <host>", "Bind address", "127.0.0.1")
	.option("-c, --config <path>", "Path to sumeru.yaml configuration file")
	.option(
		"--ocas-dir <path>",
		"Directory for the ocas content-addressed store (default: $SUMERU_OCAS_DIR or ~/.sumeru/ocas)",
	)
	.option(
		"--force",
		"Kill any process holding the chosen port before binding (sends SIGTERM, then SIGKILL after 2s)",
	)
	.action(async (opts) => {
		const port = Number.parseInt(opts.port, 10);
		if (Number.isNaN(port) || port < 0) {
			console.error(`Invalid --port value: ${opts.port}`);
			process.exit(1);
		}
		const host = String(opts.host);
		const force = Boolean(opts.force);
		const ocasDir =
			typeof opts.ocasDir === "string" && opts.ocasDir.length > 0
				? opts.ocasDir
				: null;

		// Load config (if any) BEFORE binding a port — we want to fail loudly
		// on bad config without leaving a half-started listener around.
		let name = "sumeru";
		let gateways: Record<string, GatewayConfig> = {};
		let workspaceRoot: string | null = null;
		if (typeof opts.config === "string" && opts.config.length > 0) {
			let cfg: InstanceConfig;
			try {
				cfg = await loadConfig(opts.config);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`Failed to load config from ${opts.config}: ${msg}`);
				process.exit(1);
			}
			name = cfg.name;
			gateways = cfg.gateways;
			workspaceRoot = cfg.workspaceRoot;
		}

		// --- PID file lifecycle (issue #33) ---
		const pidFilePath = resolvePidFilePath();
		const existingPid = readPidFile(pidFilePath);
		if (existingPid !== null) {
			if (isProcessAlive(existingPid)) {
				if (force) {
					try {
						await killHolder(existingPid, port, host);
						console.error(
							`[sumeru] killed pid ${existingPid} from stale pid file`,
						);
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						console.error(`Failed to kill pid ${existingPid}: ${msg}`);
						process.exit(1);
					}
				} else {
					console.error(
						`Another sumeru appears to be running (pid ${existingPid}, recorded in ${pidFilePath}).\n  Stop it first, or run \`sumeru start … --force\` to terminate it.`,
					);
					process.exit(1);
				}
			} else {
				console.error(
					`[sumeru] removing stale pid file (pid ${existingPid} not running)`,
				);
				// fall through; writePidFile below will overwrite.
			}
		}

		try {
			writePidFile(pidFilePath, process.pid);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[sumeru] could not write pid file ${pidFilePath}: ${msg}`);
			// Best-effort — continue startup.
		}

		try {
			const server = await startServerWithRetry({
				port,
				host,
				name,
				version: findVersion(),
				gateways,
				workspaceRoot,
				ocasDir,
				force,
			});
			console.log(`Listening on http://${server.host}:${server.port}`);

			let shuttingDown = false;
			const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
				if (shuttingDown) {
					// Second signal — escape hatch for a hung shutdown.
					const code = signal === "SIGINT" ? 130 : 143;
					process.exit(code);
				}
				shuttingDown = true;
				console.error(`[sumeru] shutting down (${signal})...`);
				try {
					await server.stop();
					try {
						removePidFile(pidFilePath);
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						console.error(`[sumeru] could not remove pid file: ${msg}`);
					}
					process.exit(0);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					console.error(`[sumeru] failed to stop server: ${msg}`);
					try {
						removePidFile(pidFilePath);
					} catch {
						/* ignore on the failure path */
					}
					process.exit(1);
				}
			};
			process.on("SIGINT", () => {
				void shutdown("SIGINT");
			});
			process.on("SIGTERM", () => {
				void shutdown("SIGTERM");
			});
		} catch (err) {
			try {
				removePidFile(pidFilePath);
			} catch {
				/* best effort on the error path */
			}
			const code =
				err instanceof Error && "code" in err
					? (err as { code: unknown }).code
					: null;
			if (code === "EADDRINUSE") {
				const holder = await lookupPortHolder(host, port);
				console.error(formatPortInUse({ host, port, holder }));
			} else {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`Failed to start server: ${msg}`);
			}
			process.exit(1);
		}
	});

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
			// Cannot identify holder — propagate the original error so the
			// generic diagnostic kicks in.
			throw err;
		}
		try {
			await killHolder(holder.pid, args.port, args.host);
		} catch (killErr) {
			const msg = killErr instanceof Error ? killErr.message : String(killErr);
			console.error(`Failed to kill pid ${holder.pid}: ${msg}`);
			process.exit(1);
		}
		console.error(
			`[sumeru] killed pid ${holder.pid} holding port ${args.port}`,
		);
		// Retry the bind once.
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

program.parse();
