import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative } from "node:path";
import type { ModelConfig } from "@sumeru/core";
import { handleControlFrame } from "./control-frames.js";
import type { HarnessConfig } from "./harness-types.js";
import { createSessionLoop } from "./session-loop.js";
import type {
	AdapterHandleYield,
	AdapterImpl,
	AdapterInboxMessage,
	AdapterInitConfig,
	AdapterManifest,
	OutboundFrame,
	SuspendValue,
} from "./types.js";

const DEFAULT_SEND_TIMEOUT_MS = 7_200_000;

const KNOWN_PROVIDER_BASE_URLS: Record<string, string> = {
	anthropic: "https://api.anthropic.com",
	openai: "https://api.openai.com/v1",
	openrouter: "https://openrouter.ai/api/v1",
};

export type SubcommandEntryOptions = {
	impl: AdapterImpl;
	harness: HarnessConfig;
	manifest: AdapterManifest;
};

export type RunSubcommandOptions = SubcommandEntryOptions & {
	argv: Array<string>;
	stdin: NodeJS.ReadableStream;
	stdout: NodeJS.WritableStream;
	env: NodeJS.ProcessEnv | null;
	sendTimeoutMs: number | null;
};

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function writeOk(stdout: NodeJS.WritableStream): void {
	stdout.write(`${JSON.stringify({ ok: true })}\n`);
}

function writeJson(stdout: NodeJS.WritableStream, value: unknown): void {
	stdout.write(`${JSON.stringify(value)}\n`);
}

function writeFrame(stdout: NodeJS.WritableStream, frame: OutboundFrame): void {
	stdout.write(`${JSON.stringify(frame)}\n`);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function abortGenerator(
	generator: AsyncGenerator<unknown, unknown>,
): Promise<void> {
	try {
		await generator.return(undefined as never);
	} catch {
		// Generator may reject on forced return; timeout suspend is terminal.
	}
}

function isImplSuspendYield(
	value: AdapterHandleYield,
): value is { type: "suspend"; value: SuspendValue } {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		value.type === "suspend"
	);
}

function resolveNativeId(impl: AdapterImpl): string | null {
	return impl.getNativeId?.() ?? null;
}

async function readOneLine(
	stdin: NodeJS.ReadableStream,
): Promise<string | null> {
	return new Promise((resolve, reject) => {
		let pending = "";
		let settled = false;

		const finish = (value: string | null): void => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(value);
		};

		const onData = (chunk: string | Buffer): void => {
			pending += typeof chunk === "string" ? chunk : chunk.toString("utf8");
			const newlineIdx = pending.indexOf("\n");
			if (newlineIdx >= 0) {
				finish(pending.slice(0, newlineIdx));
			}
		};

		const onEnd = (): void => {
			if (pending.length > 0) {
				finish(pending);
				return;
			}
			finish(null);
		};

		const onError = (err: Error): void => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(err);
		};

		const cleanup = (): void => {
			stdin.removeListener("data", onData);
			stdin.removeListener("end", onEnd);
			stdin.removeListener("error", onError);
		};

		stdin.setEncoding("utf8");
		stdin.on("data", onData);
		stdin.on("end", onEnd);
		stdin.on("error", onError);
	});
}

function parseAdapterInboxMessage(value: unknown): AdapterInboxMessage | null {
	if (!isRecord(value)) return null;
	if (typeof value.messageId !== "string") return null;
	if (typeof value.content !== "string") return null;
	const project = value.project;
	if (project !== null && typeof project !== "string") return null;
	return {
		messageId: value.messageId,
		content: value.content,
		project: project as string | null,
	};
}

function parseAdapterInitConfig(value: unknown): AdapterInitConfig | null {
	if (!isRecord(value)) return null;
	if (typeof value.instructions !== "string") return null;
	if (!Array.isArray(value.skills)) return null;
	const skills: AdapterInitConfig["skills"] = [];
	for (const skill of value.skills) {
		if (!isRecord(skill)) return null;
		if (typeof skill.name !== "string") return null;
		if (typeof skill.content !== "string") return null;
		skills.push({ name: skill.name, content: skill.content });
	}
	const model = value.model;
	if (!isRecord(model)) return null;
	if (typeof model.name !== "string") return null;
	const apiKey = model.apiKey;
	if (apiKey !== null && typeof apiKey !== "string") return null;
	const provider = model.provider;
	if (typeof provider === "string") {
		if (
			provider !== "anthropic" &&
			provider !== "openai" &&
			provider !== "openrouter" &&
			provider !== "builtin"
		) {
			return null;
		}
		return {
			instructions: value.instructions,
			skills,
			model: {
				provider,
				name: model.name,
				apiKey: apiKey as string | null,
			},
		};
	}
	if (!isRecord(provider)) return null;
	if (typeof provider.name !== "string") return null;
	if (typeof provider.endpoint !== "string") return null;
	if (provider.apiType !== "openai" && provider.apiType !== "anthropic") {
		return null;
	}
	return {
		instructions: value.instructions,
		skills,
		model: {
			provider: {
				name: provider.name,
				endpoint: provider.endpoint,
				apiType: provider.apiType,
			},
			name: model.name,
			apiKey: apiKey as string | null,
		},
	};
}

function modelConfigToControlValue(model: ModelConfig): {
	baseUrl: string;
	apiKey: string | null;
	model: string;
	provider: string | null;
} {
	if (typeof model.provider === "string") {
		return {
			baseUrl:
				KNOWN_PROVIDER_BASE_URLS[model.provider] ?? "https://api.anthropic.com",
			apiKey: model.apiKey,
			model: model.name,
			provider: model.provider,
		};
	}
	return {
		baseUrl: model.provider.endpoint,
		apiKey: model.apiKey,
		model: model.name,
		provider: model.provider.name,
	};
}

function parseSkillNameFromFrontmatter(
	content: string,
	fallback: string,
): string {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (match === null) return fallback;
	const body = match[1];
	if (body === undefined) return fallback;
	const nameMatch = body.match(/^name:\s*(.+)$/m);
	if (nameMatch === null || nameMatch[1] === undefined) return fallback;
	return nameMatch[1].trim().replace(/^["']|["']$/g, "");
}

async function collectFiles(
	dir: string,
	base: string,
): Promise<Array<{ path: string; content: string }>> {
	const entries = await readdir(dir, { withFileTypes: true });
	const files: Array<{ path: string; content: string }> = [];
	for (const entry of entries) {
		const fullPath = join(dir, entry.name);
		if (entry.isDirectory()) {
			const nested = await collectFiles(fullPath, base);
			files.push(...nested);
			continue;
		}
		if (!entry.isFile()) continue;
		const rel = relative(base, fullPath);
		if (rel === "SKILL.md") continue;
		files.push({
			path: rel,
			content: await readFile(fullPath, "utf8"),
		});
	}
	return files;
}

async function handleInfo(
	manifest: AdapterManifest,
	stdout: NodeJS.WritableStream,
): Promise<number> {
	writeJson(stdout, {
		name: manifest.name,
		providerMode: manifest.providerMode,
		credentialEnv: manifest.credentialEnv,
		listModels: manifest.listModels === null ? null : true,
	});
	return 0;
}

async function handleConfig(options: RunSubcommandOptions): Promise<number> {
	const line = await readOneLine(options.stdin);
	if (line === null || line.trim() === "") {
		return 2;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return 2;
	}
	const config = parseAdapterInitConfig(parsed);
	if (config === null) {
		return 2;
	}

	try {
		const modelValue = modelConfigToControlValue(config.model);
		await handleControlFrame(options.harness, {
			type: "model",
			value: modelValue,
		});

		if (options.harness.personaPath !== null) {
			await mkdir(dirname(options.harness.personaPath), { recursive: true });
			await writeFile(options.harness.personaPath, config.instructions, "utf8");
		}

		for (const skill of config.skills) {
			await handleControlFrame(options.harness, {
				type: "install-skill",
				value: { name: skill.name, content: skill.content, files: [] },
			});
		}

		await options.impl.init(config);
		writeOk(options.stdout);
		return 0;
	} catch {
		return 1;
	}
}

async function handleReset(options: RunSubcommandOptions): Promise<number> {
	try {
		await handleControlFrame(options.harness, {
			type: "reset",
			value: {},
		});
		writeOk(options.stdout);
		return 0;
	} catch {
		return 1;
	}
}

async function handleMessage(options: RunSubcommandOptions): Promise<number> {
	const line = await readOneLine(options.stdin);
	if (line === null || line.trim() === "") {
		return 2;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return 2;
	}
	const message = parseAdapterInboxMessage(parsed);
	if (message === null) {
		return 2;
	}

	if (options.impl.resume !== undefined) {
		try {
			await options.impl.resume();
		} catch (err) {
			writeFrame(options.stdout, {
				type: "error",
				value: { code: "resume_error", message: errorMessage(err) },
			});
			return 1;
		}
	}

	const handleTimeoutMs = options.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
	const generator = options.impl.handle(message);
	const startedAt = Date.now();
	const timeoutPromise = delay(handleTimeoutMs).then(() => ({
		kind: "timeout" as const,
	}));

	try {
		while (true) {
			const raced = await Promise.race([
				generator.next().then((step) => ({ kind: "next" as const, step })),
				timeoutPromise,
			]);

			if (raced.kind === "timeout") {
				writeFrame(options.stdout, {
					type: "suspend",
					value: {
						reason: "timeout",
						elapsedMs: Date.now() - startedAt,
						nativeId: resolveNativeId(options.impl),
					},
				});
				void abortGenerator(generator);
				return 3;
			}

			const step = raced.step;
			if (step.done === true) {
				writeFrame(options.stdout, { type: "done", value: step.value });
				return 0;
			}
			if (isImplSuspendYield(step.value)) {
				writeFrame(options.stdout, {
					type: "suspend",
					value: {
						...step.value.value,
						nativeId: resolveNativeId(options.impl),
					},
				});
				return 3;
			}
			writeFrame(options.stdout, { type: "turn", value: step.value });
		}
	} catch (err) {
		writeFrame(options.stdout, {
			type: "error",
			value: { code: "handler_error", message: errorMessage(err) },
		});
		return 1;
	}
}

async function handleTurns(options: RunSubcommandOptions): Promise<number> {
	try {
		if (options.impl.getTurns === undefined) {
			writeJson(options.stdout, []);
			return 0;
		}
		const turns = options.impl.getTurns();
		if (Array.isArray(turns)) {
			for (const turn of turns) {
				writeJson(options.stdout, turn);
			}
			return 0;
		}
		for await (const turn of turns) {
			writeJson(options.stdout, turn);
		}
		return 0;
	} catch {
		return 1;
	}
}

function parseFromFlag(argv: Array<string>): string | null {
	const idx = argv.indexOf("--from");
	if (idx < 0) return null;
	const value = argv[idx + 1];
	if (value === undefined || value.length === 0) return null;
	return value;
}

async function handleInstallSkill(
	options: RunSubcommandOptions,
): Promise<number> {
	const fromPath = parseFromFlag(options.argv);
	if (fromPath === null) {
		return 1;
	}
	try {
		const skillMdPath = join(fromPath, "SKILL.md");
		const content = await readFile(skillMdPath, "utf8");
		const name = parseSkillNameFromFrontmatter(content, basename(fromPath));
		const files = await collectFiles(fromPath, fromPath);
		await handleControlFrame(options.harness, {
			type: "install-skill",
			value: { name, content, files },
		});
		writeOk(options.stdout);
		return 0;
	} catch {
		return 1;
	}
}

async function handleUninstallSkill(
	options: RunSubcommandOptions,
): Promise<number> {
	const name = options.argv[3];
	if (name === undefined || name.length === 0) {
		return 1;
	}
	if (options.harness.skillsDir === null) {
		writeOk(options.stdout);
		return 0;
	}
	try {
		await rm(join(options.harness.skillsDir, name), {
			recursive: true,
			force: true,
		});
		writeOk(options.stdout);
		return 0;
	} catch {
		return 1;
	}
}

async function handleListModels(
	options: RunSubcommandOptions,
): Promise<number> {
	try {
		if (options.manifest.listModels === null) {
			writeJson(options.stdout, []);
			return 0;
		}
		const env = options.env ?? process.env;
		const credentialEnv = options.manifest.credentialEnv;
		const credential = credentialEnv !== null ? (env[credentialEnv] ?? "") : "";
		const models = await options.manifest.listModels(credential);
		writeJson(options.stdout, models);
		return 0;
	} catch {
		return 1;
	}
}

export async function runSubcommand(
	options: RunSubcommandOptions,
): Promise<number> {
	const command = options.argv[2];
	if (command === undefined || command.length === 0) {
		return 1;
	}

	switch (command) {
		case "info":
			return handleInfo(options.manifest, options.stdout);
		case "config":
			return handleConfig(options);
		case "reset":
			return handleReset(options);
		case "message":
			return handleMessage(options);
		case "turns":
			return handleTurns(options);
		case "install-skill":
			return handleInstallSkill(options);
		case "uninstall-skill":
			return handleUninstallSkill(options);
		case "list-models":
			return handleListModels(options);
		default:
			return 1;
	}
}

export function createSubcommandEntry(options: SubcommandEntryOptions): void {
	const command = process.argv[2];
	if (command === undefined || command.length === 0) {
		createSessionLoop(options.impl, options.harness);
		return;
	}

	void runSubcommand({
		...options,
		argv: process.argv,
		stdin: process.stdin,
		stdout: process.stdout,
		env: process.env,
		sendTimeoutMs: null,
	})
		.then((code) => {
			process.exit(code);
		})
		.catch((err: unknown) => {
			process.stdout.write(
				`${JSON.stringify({
					type: "error",
					value: { code: "fatal_error", message: errorMessage(err) },
				})}\n`,
			);
			process.exit(1);
		});
}
