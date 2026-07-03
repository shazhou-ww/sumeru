import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import type { Prototype } from "@sumeru/core";
import type { PrototypeInfo } from "./types.js";

const SUMERU_IMAGE_PREFIX = "sumeru/";
const EXCLUDED_IMAGE_NAMES = new Set(["base"]);
const PREFERRED_TAGS = ["dev", "latest"];

export type DockerImageRow = {
	Repository: string;
	Tag: string;
	ID: string;
};

export type DockerInspectLabels = Record<string, string>;

type RunCommandResult = {
	stdout: string;
	stderr: string;
	exitCode: number;
};

export type DiscoverDockerPrototypesOptions = {
	dockerBin?: string;
	runCommand?: typeof runDockerCommand;
};

function runDockerCommand(args: Array<string>): Promise<RunCommandResult> {
	return new Promise((resolve, reject) => {
		const child = spawn(args[0] as string, args.slice(1), {
			stdio: ["ignore", "pipe", "pipe"],
		});
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
		child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
		child.on("error", reject);
		child.on("close", (code) => {
			resolve({
				stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
				stderr: Buffer.concat(stderrChunks).toString("utf-8"),
				exitCode: code ?? 1,
			});
		});
	});
}

export function parseSumeruImageRef(
	repository: string,
	tag: string,
): { name: string; imageTag: string } | null {
	if (!repository.startsWith(SUMERU_IMAGE_PREFIX)) {
		return null;
	}
	const name = repository.slice(SUMERU_IMAGE_PREFIX.length);
	if (
		name.length === 0 ||
		name.includes("/") ||
		EXCLUDED_IMAGE_NAMES.has(name)
	) {
		return null;
	}
	if (tag.length === 0 || tag === "<none>") {
		return null;
	}
	return { name, imageTag: `${repository}:${tag}` };
}

export function pickPreferredImageTag(
	candidates: Array<{ tag: string; imageTag: string }>,
): { tag: string; imageTag: string } | null {
	if (candidates.length === 0) {
		return null;
	}
	for (const preferred of PREFERRED_TAGS) {
		const match = candidates.find((item) => item.tag === preferred);
		if (match !== undefined) {
			return match;
		}
	}
	return candidates[0] ?? null;
}

export function prototypeFromDockerLabels(input: {
	name: string;
	imageTag: string;
	imageId: string;
	labels: DockerInspectLabels;
}): PrototypeInfo {
	const harness = input.labels["sumeru.harness"] ?? input.name;
	const modelRaw = input.labels["sumeru.model"];
	const model = modelRaw !== undefined && modelRaw.length > 0 ? modelRaw : null;
	const persona = input.labels["sumeru.persona"] ?? "default";
	const prototype: Prototype = {
		name: input.name,
		persona,
		model,
		adapter: harness,
		extensions: null,
		defaults: null,
	};
	return {
		name: input.name,
		prototype,
		yamlPath: "",
		prototypeHash: computeImagePrototypeHash(input.imageId, input.labels),
		composePath: null,
		imageTag: input.imageTag,
	};
}

export function computeImagePrototypeHash(
	imageId: string,
	labels: DockerInspectLabels,
): string {
	const hash = createHash("sha256");
	hash.update("docker-image\0");
	hash.update(imageId);
	for (const key of Object.keys(labels).sort()) {
		hash.update(`${key}=${labels[key] ?? ""}\0`);
	}
	return hash.digest("hex");
}

export function mergeDockerWithYaml(
	docker: PrototypeInfo,
	yaml: PrototypeInfo | null,
): PrototypeInfo {
	if (yaml === null) {
		return docker;
	}
	const persona =
		docker.prototype.persona !== "default"
			? docker.prototype.persona
			: yaml.prototype.persona;
	return {
		name: docker.name,
		prototype: {
			name: docker.name,
			adapter: docker.prototype.adapter,
			persona,
			model: docker.prototype.model ?? yaml.prototype.model,
			extensions: yaml.prototype.extensions,
			defaults: yaml.prototype.defaults ?? docker.prototype.defaults,
		},
		yamlPath: yaml.yamlPath,
		prototypeHash: docker.prototypeHash,
		composePath: null,
		imageTag: docker.imageTag,
	};
}

export async function discoverDockerPrototypes(
	options: DiscoverDockerPrototypesOptions = {},
): Promise<Map<string, PrototypeInfo>> {
	const dockerBin = options.dockerBin ?? "docker";
	const runCommand = options.runCommand ?? runDockerCommand;
	const listResult = await runCommand([
		dockerBin,
		"images",
		"--filter",
		"reference=sumeru/*",
		"--format",
		"{{json .}}",
	]);
	if (listResult.exitCode !== 0) {
		return new Map();
	}

	const grouped = new Map<
		string,
		Array<{ tag: string; imageTag: string; imageId: string }>
	>();
	for (const line of listResult.stdout.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.length === 0) {
			continue;
		}
		let row: DockerImageRow;
		try {
			row = JSON.parse(trimmed) as DockerImageRow;
		} catch {
			continue;
		}
		const parsed = parseSumeruImageRef(row.Repository, row.Tag);
		if (parsed === null) {
			continue;
		}
		const bucket = grouped.get(parsed.name) ?? [];
		bucket.push({
			tag: row.Tag,
			imageTag: parsed.imageTag,
			imageId: row.ID,
		});
		grouped.set(parsed.name, bucket);
	}

	const prototypes = new Map<string, PrototypeInfo>();
	for (const [name, candidates] of grouped) {
		const selected = pickPreferredImageTag(candidates);
		if (selected === null) {
			continue;
		}
		const labels = await inspectImageLabels(
			dockerBin,
			runCommand,
			selected.imageTag,
		);
		const imageId =
			candidates.find((item) => item.imageTag === selected.imageTag)?.imageId ??
			selected.imageTag;
		prototypes.set(
			name,
			prototypeFromDockerLabels({
				name,
				imageTag: selected.imageTag,
				imageId,
				labels,
			}),
		);
	}
	return prototypes;
}

export async function discoverDockerPrototypeByName(
	name: string,
	options: DiscoverDockerPrototypesOptions = {},
): Promise<PrototypeInfo | null> {
	const prototypes = await discoverDockerPrototypes(options);
	return prototypes.get(name) ?? null;
}

async function inspectImageLabels(
	dockerBin: string,
	runCommand: typeof runDockerCommand,
	imageTag: string,
): Promise<DockerInspectLabels> {
	const result = await runCommand([
		dockerBin,
		"inspect",
		"--format",
		"{{json .Config.Labels}}",
		imageTag,
	]);
	if (result.exitCode !== 0) {
		return {};
	}
	const trimmed = result.stdout.trim();
	if (trimmed.length === 0 || trimmed === "null") {
		return {};
	}
	try {
		const parsed = JSON.parse(trimmed) as Record<string, string | null>;
		const labels: DockerInspectLabels = {};
		for (const [key, value] of Object.entries(parsed)) {
			if (typeof value === "string") {
				labels[key] = value;
			}
		}
		return labels;
	} catch {
		return {};
	}
}

export function snapshotImageLabels(
	prototype: Prototype,
): Record<string, string> {
	const labels: Record<string, string> = {
		"sumeru.harness": prototype.adapter,
		"sumeru.persona": prototype.persona,
	};
	if (prototype.model !== null) {
		labels["sumeru.model"] = prototype.model;
	}
	return labels;
}
