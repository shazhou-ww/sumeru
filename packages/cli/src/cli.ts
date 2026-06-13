#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

program.parse();
