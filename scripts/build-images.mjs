#!/usr/bin/env node
/**
 * Build Sumeru adapter Docker images and export to images/ directory.
 *
 * Usage:
 *   node scripts/build-images.mjs           # build all images
 *   node scripts/build-images.mjs sarsapa   # build only sarsapa
 *   node scripts/build-images.mjs --list    # list available images
 *
 * Output: images/<name>.tar.gz (gitignored)
 *
 * Build order: base → adapters (base is the foundation, adapters depend on it)
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const imagesDir = join(rootDir, "images");
const dockerDir = join(rootDir, "docker");

const IMAGE_DEFS = [
	{ name: "base", tag: "sumeru/base:dev", dockerfile: "base.Dockerfile" },
	{
		name: "sarsapa",
		tag: "sumeru/sarsapa:dev",
		dockerfile: "sarsapa.Dockerfile",
		depends: ["base"],
	},
	{
		name: "claude-code",
		tag: "sumeru/claude-code:dev",
		dockerfile: "claude-code.Dockerfile",
		depends: ["base"],
	},
	{
		name: "codex",
		tag: "sumeru/codex:dev",
		dockerfile: "codex.Dockerfile",
		depends: ["base"],
	},
	{
		name: "cursor-agent",
		tag: "sumeru/cursor-agent:dev",
		dockerfile: "cursor-agent.Dockerfile",
		depends: ["base"],
	},
	{
		name: "hermes",
		tag: "sumeru/hermes:dev",
		dockerfile: "hermes.Dockerfile",
		depends: ["base"],
	},
];

function run(cmd, label) {
	console.log(`  ▸ ${label}`);
	execSync(cmd, { cwd: rootDir, stdio: "inherit" });
}

function buildImage(def) {
	const dockerfile = join(dockerDir, def.dockerfile);
	if (!existsSync(dockerfile)) {
		console.error(`  ✗ Dockerfile not found: ${dockerfile}`);
		process.exit(1);
	}
	console.log(`\n📦 Building ${def.tag} from ${def.dockerfile}`);
	run(`docker build -t ${def.tag} -f ${dockerfile} .`, `docker build ${def.tag}`);
}

function exportImage(def) {
	const tarPath = join(imagesDir, `${def.name}.tar.gz`);
	console.log(`\n💾 Exporting ${def.tag} → images/${def.name}.tar.gz`);
	run(`docker save ${def.tag} | gzip > ${tarPath}`, `docker save | gzip`);
}

function main() {
	const args = process.argv.slice(2);

	if (args.includes("--list") || args.includes("-l")) {
		console.log("Available images:");
		for (const def of IMAGE_DEFS) {
			const deps = def.depends?.length ? ` (depends: ${def.depends.join(", ")})` : "";
			console.log(`  ${def.name.padEnd(16)} ${def.tag}${deps}`);
		}
		return;
	}

	const names = args.length > 0 ? args : IMAGE_DEFS.map((d) => d.name);

	// Validate names
	for (const name of names) {
		if (!IMAGE_DEFS.find((d) => d.name === name)) {
			console.error(`Unknown image: ${name}`);
			console.error(`Available: ${IMAGE_DEFS.map((d) => d.name).join(", ")}`);
			process.exit(1);
		}
	}

	// Ensure base is included if any adapter is requested
	const needsBase =
		names.some((n) => n !== "base") && !names.includes("base");
	const buildOrder = [...IMAGE_DEFS].filter(
		(d) => names.includes(d.name) || (needsBase && d.name === "base"),
	);

	mkdirSync(imagesDir, { recursive: true });

	console.log(`🔨 Building ${buildOrder.length} image(s)...`);
	for (const def of buildOrder) {
		buildImage(def);
	}

	console.log(`\n📦 Exporting ${buildOrder.length} image(s)...`);
	for (const def of buildOrder) {
		exportImage(def);
	}

	console.log(`\n✅ Done. Images saved to images/`);
	for (const def of buildOrder) {
		console.log(`   images/${def.name}.tar.gz`);
	}
}

main();
