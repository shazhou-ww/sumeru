#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCLI } from "@ocas/cli-kit";
import {
	type GatewayConfig,
	type InstanceConfig,
	loadConfig,
	materializeDockerAssets,
	startServer,
} from "@sumeru/server";
import { z } from "zod";
import { buildAdapters } from "./build-adapters.js";
import { type DeployConfig, loadDeployConfig } from "./deploy-config.js";
import {
	DOCKER_UNAVAILABLE_MESSAGE,
	isDockerAvailable,
	launchDockerCompose,
} from "./docker-launch.js";
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

// --- Early: --version / -v (before cli-kit, which doesn't handle these) ---
// See https://git.shazhou.work/shazhou/ocas/issues/230 (missing --help support)

const firstToken = process.argv[2];
if (firstToken === "--version" || firstToken === "-v") {
	process.stdout.write(`${VERSION}\n`);
	process.exit(0);
}

// --- Early: top-level --help / -h / no args ---

const HELP_TEXT = `Usage: sumeru <command> [options]

Commands:
  start    Start the Sumeru HTTP server
  run      [planned] Run a scene with a specified adapter and model
  list     [planned] List available scenes

Standard flags:
  --format <yaml|json|text>    Output format (default: yaml)
  --compact                    Compact output
  --quiet                      Suppress stderr yields
  --json                       Shorthand for --format json --compact

Options:
  -h, --help                   Show this help
  -v, --version                Show version
`;

const argv = process.argv.slice(2);
const firstArg = argv[0];
if (firstArg === undefined || firstArg === "--help" || firstArg === "-h") {
	process.stdout.write(HELP_TEXT);
	process.exit(0);
}

// --- Per-command --help (cli-kit doesn't generate per-command help) ---

const START_HELP = `Usage: sumeru start [options]

Start the Sumeru HTTP server

Options:
  -p, --port <number>      TCP port to bind (0 = ephemeral) (default: 7900)
  -h, --host <host>        Bind address (default: 127.0.0.1)
  -c, --config <path>      Path to sumeru.yaml configuration file
  --ocas-dir <path>        Directory for the ocas content-addressed store (default: $SUMERU_OCAS_DIR or ~/.sumeru/ocas)
  --force                  Kill any process holding the chosen port before binding (sends SIGTERM, then SIGKILL after 2s)
  --emit-assets            Release the Docker compose templates next to the config, then exit (do not launch)
`;

const RUN_HELP = `Usage: sumeru run [options]

[planned] Run a scene with a specified adapter and model

Options:
  -s, --scene <path>       Path to scene directory or YAML
  -r, --runner <type>      Adapter type (hermes, claude-code)
  -m, --model <model>      Model identifier
  -t, --timeout <seconds>  Timeout in seconds (default: 300)
  --network                Allow network access (default)
  --no-network             Disable network access
  -o, --output <path>      Output path for recording
`;

if (firstArg === "start" && (argv[1] === "--help" || argv[1] === "-h")) {
	process.stdout.write(START_HELP);
	process.exit(0);
}
if (firstArg === "run" && (argv[1] === "--help" || argv[1] === "-h")) {
	process.stdout.write(RUN_HELP);
	process.exit(0);
}

// --- Schemas ---

const notImplementedSchema = z.object({
	command: z.string(),
	status: z.literal("not_implemented"),
});

// Dummy schema for start — the action always calls process.exit(), so the
// return value is never validated. This just satisfies cli-kit's requirement
// that executable commands declare a .returns().
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

// start — long-running server process.
//
// cli-kit's output system (returns/yields/NDJSON) is bypassed entirely:
// the action uses process.stdout/stderr.write() + process.exit() for all
// output, and returns undefined so cli-kit doesn't render anything.
// This preserves the exact output format the e2e tests expect.
//
// Short flags (-c, -p, -h) are defined as separate flag names because
// cli-kit doesn't support flag aliases (issue #230).
cli
	.command("start")
	.flag("port", { type: "number", default: 7900 })
	.flag("host", { type: "string", default: "127.0.0.1" })
	.flag("config", { type: "string" })
	.flag("c", { type: "string" }) // short alias for --config
	.flag("ocas-dir", { type: "string" })
	.flag("force", { type: "boolean", default: false })
	.flag("emit-assets", { type: "boolean", default: false })
	.returns(startResultSchema, "")
	.action(async (_args, flags) => {
		const port = flags.port as number;
		const host = flags.host as string;
		const force = flags.force as boolean;
		const configPath =
			(flags.config as string | undefined) ??
			(flags.c as string | undefined) ??
			null;
		const ocasDirRaw = flags["ocas-dir"] as string | undefined;
		const ocasDir =
			typeof ocasDirRaw === "string" && ocasDirRaw.length > 0
				? ocasDirRaw
				: null;
		const emitAssets = flags["emit-assets"] as boolean;

		// --- `--emit-assets`: materialize-and-exit (issue #85) ---
		// Pure side-effecting file emit feeding the manual `docker compose` flow.
		// It short-circuits BEFORE any deploy-mode dispatch: no Docker probe, no
		// pid file, no port bind, no startServer, no `docker compose up`. Unlike
		// the implicit auto-start path it MAY overwrite (explicit refresh), which
		// is exactly `materializeDockerAssets`' unconditional copy.
		if (emitAssets) {
			if (configPath === null) {
				process.stderr.write(
					"--emit-assets requires -c <config> to choose the target directory.\n",
				);
				process.exit(1);
			}
			const written = materializeDockerAssets(dirname(configPath));
			for (const p of written) process.stdout.write(`[sumeru] wrote ${p}\n`);
			process.exit(0);
		}

		// Load config (if any) BEFORE binding a port — we want to fail loudly
		// on bad config without leaving a half-started listener around.
		let name = "sumeru";
		let gateways: Record<string, GatewayConfig> = {};
		let workspaceRoot: string | null = null;
		if (configPath !== null) {
			let cfg: InstanceConfig;
			try {
				cfg = await loadConfig(configPath);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				process.stderr.write(
					`Failed to load config from ${configPath}: ${msg}\n`,
				);
				process.exit(1);
			}
			name = cfg.name;
			gateways = cfg.gateways;
			workspaceRoot = cfg.workspaceRoot;

			// --- deploy.mode dispatch (issue #85) ---
			// docker mode is a thin `docker compose` wrapper: NO local pid file,
			// NO port bind, NO startServer. Probe Docker first; an unavailable
			// daemon is a hard stop (no silent fallback to local). local / absent
			// deploy blocks fall through to the existing local path below.
			let deploy: DeployConfig;
			try {
				deploy = await loadDeployConfig(configPath);
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				process.stderr.write(
					`Failed to load config from ${configPath}: ${msg}\n`,
				);
				process.exit(1);
			}
			if (deploy.mode === "docker") {
				if (!isDockerAvailable()) {
					process.stderr.write(`${DOCKER_UNAVAILABLE_MESSAGE}\n`);
					process.exit(1);
				}
				let code: number;
				try {
					code = await launchDockerCompose({ name, configPath, deploy });
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					process.stderr.write(`Failed to start docker compose: ${msg}\n`);
					process.exit(1);
				}
				process.exit(code);
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
						process.stderr.write(
							`[sumeru] killed pid ${existingPid} from stale pid file\n`,
						);
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						process.stderr.write(`Failed to kill pid ${existingPid}: ${msg}\n`);
						process.exit(1);
					}
				} else {
					process.stderr.write(
						`Another sumeru appears to be running (pid ${existingPid}, recorded in ${pidFilePath}).\n  Stop it first, or run \`sumeru start … --force\` to terminate it.\n`,
					);
					process.exit(1);
				}
			} else {
				process.stderr.write(
					`[sumeru] removing stale pid file (pid ${existingPid} not running)\n`,
				);
				// fall through; writePidFile below will overwrite.
			}
		}

		try {
			writePidFile(pidFilePath, process.pid);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			process.stderr.write(
				`[sumeru] could not write pid file ${pidFilePath}: ${msg}\n`,
			);
			// Best-effort — continue startup.
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
			process.stdout.write(
				`Listening on http://${server.host}:${server.port}\n`,
			);

			// Block until shutdown signal
			await new Promise<void>((_resolve) => {
				let shuttingDown = false;
				const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
					if (shuttingDown) {
						// Second signal — escape hatch for a hung shutdown.
						const code = signal === "SIGINT" ? 130 : 143;
						process.exit(code);
					}
					shuttingDown = true;
					process.stderr.write(`[sumeru] shutting down (${signal})...\n`);
					try {
						await server.stop();
						try {
							removePidFile(pidFilePath);
						} catch (err) {
							const msg = err instanceof Error ? err.message : String(err);
							process.stderr.write(
								`[sumeru] could not remove pid file: ${msg}\n`,
							);
						}
						process.exit(0);
					} catch (err) {
						const msg = err instanceof Error ? err.message : String(err);
						process.stderr.write(`[sumeru] failed to stop server: ${msg}\n`);
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
			});

			// If the promise resolves without process.exit (shouldn't happen
			// in normal flow, but TypeScript needs a return), exit gracefully.
			process.exit(0);
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
				process.stderr.write(formatPortInUse({ host, port, holder }));
			} else {
				const msg = err instanceof Error ? err.message : String(err);
				process.stderr.write(`Failed to start server: ${msg}\n`);
			}
			process.exit(1);
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
	.flag("no-network", { type: "boolean", default: false })
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
			// Cannot identify holder — propagate the original error so the
			// generic diagnostic kicks in.
			throw err;
		}
		try {
			await killHolder(holder.pid, args.port, args.host);
		} catch (killErr) {
			const msg = killErr instanceof Error ? killErr.message : String(killErr);
			process.stderr.write(`Failed to kill pid ${holder.pid}: ${msg}\n`);
			process.exit(1);
		}
		process.stderr.write(
			`[sumeru] killed pid ${holder.pid} holding port ${args.port}\n`,
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

const exitCode = await cli.run();
if (exitCode !== 0) {
	process.exit(exitCode);
}
