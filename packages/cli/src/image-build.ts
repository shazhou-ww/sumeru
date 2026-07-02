import { spawnSync } from "node:child_process";
import { access, cp, mkdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createHostClient } from "./http-client.js";

const SUPPORTED_AGENTS = [
	"hermes",
	"claude-code",
	"codex",
	"sarsapa",
	"cursor-agent",
] as const;

type AgentType = (typeof SUPPORTED_AGENTS)[number];

export type ImageBuildOptions = {
	name: string;
	agent: string;
	adapter: string | null;
	baseUrl: string;
	repoRoot: string;
};

export type ImageBuildResult = {
	tag: string;
	digest: string;
};

export async function runImageBuild(
	options: ImageBuildOptions,
): Promise<ImageBuildResult> {
	const agent = parseAgentType(options.agent);
	const adapterPath = resolveAdapterPath(
		options.repoRoot,
		agent,
		options.adapter,
	);
	const dockerTag = deriveDockerTag(options.name, options.adapter);
	const dockerfileSource = join(adapterPath, "Dockerfile");
	const buildDir = join(options.repoRoot, ".build");
	const packagesDir = join(buildDir, "packages");

	await rm(buildDir, { recursive: true, force: true });
	await mkdir(packagesDir, { recursive: true });

	await copyPackageDist(
		join(options.repoRoot, "packages/core"),
		join(packagesDir, "core"),
	);
	await copyPackageDist(
		join(options.repoRoot, "packages/adapter-core"),
		join(packagesDir, "adapter-core"),
	);
	const adapterDest = adapterPackagesPath(agent);
	await copyPackageDist(adapterPath, join(packagesDir, adapterDest));

	await cp(dockerfileSource, join(buildDir, "Dockerfile"));
	const dockerignore = join(options.repoRoot, ".dockerignore");
	try {
		await cp(dockerignore, join(buildDir, ".dockerignore"));
	} catch {
		// optional
	}

	const buildResult = spawnSync(
		"docker",
		["build", "-t", dockerTag, "-f", "Dockerfile", "."],
		{
			cwd: buildDir,
			encoding: "utf-8",
			stdio: "inherit",
		},
	);
	if (buildResult.error !== undefined) {
		throw new Error(`docker build failed: ${buildResult.error.message}`);
	}
	if (buildResult.status !== 0) {
		throw new Error(
			`docker build exited with code ${String(buildResult.status)}`,
		);
	}

	const digest = inspectImageDigest(dockerTag);
	const builtAt = new Date().toISOString();
	const client = createHostClient({ baseUrl: options.baseUrl });
	await client.addImage(options.name, {
		name: options.name,
		description: `Sumeru ${agent} image (${dockerTag})`,
		dockerfile: relative(options.repoRoot, dockerfileSource),
		builtAt,
		digest,
	});

	return { tag: dockerTag, digest };
}

export async function findRepoRoot(startDir: string): Promise<string> {
	let current = resolve(startDir);
	for (;;) {
		try {
			await access(join(current, "pnpm-workspace.yaml"));
			return current;
		} catch {
			const parent = dirname(current);
			if (parent === current) {
				throw new Error(
					"Could not find monorepo root (pnpm-workspace.yaml). Run from the sumeru repository.",
				);
			}
			current = parent;
		}
	}
}

function parseAgentType(value: string): AgentType {
	if ((SUPPORTED_AGENTS as ReadonlyArray<string>).includes(value)) {
		return value as AgentType;
	}
	throw new Error(
		`Unsupported agent type ${value}. Supported: ${SUPPORTED_AGENTS.join(", ")}`,
	);
}

function resolveAdapterPath(
	repoRoot: string,
	agent: AgentType,
	adapter: string | null,
): string {
	const spec = adapter ?? defaultAdapterSpec(agent);
	if (!isLocalAdapterSpec(spec)) {
		throw new Error(
			`Adapter ${spec} is not a local path. Only local adapters (paths starting with . or /) are supported for now.`,
		);
	}
	const resolved = isAbsolute(spec) ? spec : resolve(repoRoot, spec);
	return resolved;
}

function defaultAdapterSpec(agent: AgentType): string {
	if (agent === "sarsapa") {
		return "./packages/sarsapa";
	}
	return `./packages/adapter-${agent}`;
}

function isLocalAdapterSpec(spec: string): boolean {
	return spec.startsWith(".") || spec.startsWith("/");
}

function adapterPackagesPath(agent: AgentType): string {
	if (agent === "sarsapa") {
		return "sarsapa";
	}
	return `adapter-${agent}`;
}

export function deriveDockerTag(
	imageName: string,
	adapter: string | null,
): string {
	if (adapter === null || isLocalAdapterSpec(adapter)) {
		return `sumeru/${imageName}:dev`;
	}
	const atIdx = adapter.lastIndexOf("@");
	if (atIdx === -1) {
		return `sumeru/${imageName}:latest`;
	}
	const version = adapter.slice(atIdx + 1);
	return `sumeru/${imageName}:${version}`;
}

async function copyPackageDist(srcDir: string, destDir: string): Promise<void> {
	await mkdir(join(destDir, "dist"), { recursive: true });
	await cp(join(srcDir, "package.json"), join(destDir, "package.json"));
	await cp(join(srcDir, "dist"), join(destDir, "dist"), { recursive: true });
}

function inspectImageDigest(tag: string): string {
	const result = spawnSync("docker", ["inspect", "--format", "{{.Id}}", tag], {
		encoding: "utf-8",
	});
	if (result.error !== undefined) {
		throw new Error(`docker inspect failed: ${result.error.message}`);
	}
	if (result.status !== 0) {
		const stderr = result.stderr.trim();
		throw new Error(
			stderr.length > 0
				? stderr
				: `docker inspect exited ${String(result.status)}`,
		);
	}
	const digest = result.stdout.trim();
	if (digest.length === 0) {
		throw new Error(`docker inspect returned empty digest for ${tag}`);
	}
	return digest;
}
