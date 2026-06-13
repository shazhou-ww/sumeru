#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer } from "@sumeru/server";
import { Command } from "commander";

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
	.description("Agent behavior observation lab — run scenes, record turns")
	.version(findVersion());

program
	.command("run")
	.description("Run a scene with a specified runner and model")
	.requiredOption("-s, --scene <path>", "Path to scene directory or YAML")
	.requiredOption(
		"-r, --runner <type>",
		"Runner type (hermes, claude-code, codex)",
	)
	.requiredOption("-m, --model <model>", "Model identifier")
	.option("-t, --timeout <seconds>", "Timeout in seconds", "300")
	.option("--network", "Allow network access", true)
	.option("--no-network", "Disable network access")
	.option("-i, --image <image>", "Docker image", "sumeru-testbox:latest")
	.option("-o, --output <path>", "Output path for recording")
	.action(async (opts) => {
		console.log("sumeru run — not yet implemented");
		console.log("Options:", JSON.stringify(opts, null, 2));
	});

program
	.command("list")
	.description("List available scenes")
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
	.action(async (opts) => {
		const port = Number.parseInt(opts.port, 10);
		if (Number.isNaN(port) || port < 0) {
			console.error(`Invalid --port value: ${opts.port}`);
			process.exit(1);
		}
		const host = String(opts.host);

		try {
			const server = await startServer({
				port,
				host,
				name: "sumeru",
				version: findVersion(),
			});
			console.log(`Listening on http://${server.host}:${server.port}`);

			const shutdown = async (): Promise<void> => {
				try {
					await server.stop();
					process.exit(0);
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err);
					console.error(`Failed to stop server: ${msg}`);
					process.exit(1);
				}
			};
			process.on("SIGINT", shutdown);
			process.on("SIGTERM", shutdown);
		} catch (err) {
			const code =
				err instanceof Error && "code" in err
					? (err as { code: unknown }).code
					: null;
			if (code === "EADDRINUSE") {
				console.error(
					`Port ${port} is already in use on ${host}. Choose a different --port or stop the conflicting process.`,
				);
			} else {
				const msg = err instanceof Error ? err.message : String(err);
				console.error(`Failed to start server: ${msg}`);
			}
			process.exit(1);
		}
	});

program.parse();
