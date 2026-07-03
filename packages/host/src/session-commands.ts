import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { getProviderMode } from "./adapter-registry.js";
import { reloadPrototypeInConfig, resolveSessionModel } from "./config.js";
import {
	prototypeFileExists,
	validateResourceName,
	writePrototypeFile,
} from "./data-store.js";
import { snapshotImageLabels } from "./docker-prototypes.js";
import { generateCommandId } from "./id.js";
import { defaultAdapterCommand } from "./transport.js";
import type {
	CommandAcceptedValue,
	CommandResultValue,
	LoadedHostConfig,
	ManagedSession,
	MessageRequest,
	SessionCommand,
	Transport,
} from "./types.js";

export type RunCommandResult =
	| { mode: "async"; value: CommandAcceptedValue }
	| { mode: "sync"; value: CommandResultValue };

export async function runSessionCommand(input: {
	hostConfig: LoadedHostConfig;
	transport: Transport;
	getSession(id: string): ManagedSession | null;
	submitMessage(id: string, body: MessageRequest): Promise<void>;
	updateSessionModel(id: string, model: ManagedSession["model"]): void;
	id: string;
	command: SessionCommand;
}): Promise<RunCommandResult> {
	const record = input.getSession(input.id);
	if (record === null) {
		throw new Error("session_not_found");
	}

	switch (input.command.type) {
		case "chat": {
			const commandId = input.command.messageId ?? generateCommandId();
			await input.submitMessage(input.id, {
				messageId: commandId,
				content: input.command.content,
				env: input.command.env,
				model: input.command.model,
			});
			return {
				mode: "async",
				value: { sessionId: input.id, commandId },
			};
		}
		case "exec": {
			const result = await execInContainer(
				input.transport,
				record,
				input.command.command,
			);
			return {
				mode: "sync",
				value: {
					type: "exec",
					stdout: result.stdout,
					stderr: result.stderr,
					exitCode: result.exitCode,
				},
			};
		}
		case "model": {
			const resolved = resolveModelCommand(
				input.hostConfig,
				record,
				input.command.provider,
				input.command.model,
			);
			await emitSessionFrame(input.transport, input.hostConfig, record, {
				type: "model",
				value: {
					baseUrl: modelBaseUrl(resolved),
					apiKey: resolved.apiKey,
					model: resolved.name,
				},
			});
			input.updateSessionModel(input.id, resolved);
			return {
				mode: "sync",
				value: {
					type: "model",
					provider: input.command.provider,
					model: input.command.model,
				},
			};
		}
		case "install-skill": {
			const skill = resolveInstallSkill(input.hostConfig, input.command);
			await emitSessionFrame(input.transport, input.hostConfig, record, {
				type: "install-skill",
				value: {
					name: skill.name,
					content: skill.content,
					files: skill.files,
				},
			});
			return {
				mode: "sync",
				value: { type: "install-skill", name: skill.name },
			};
		}
		case "reset": {
			const value =
				input.command.persona === null
					? {}
					: { persona: input.command.persona };
			await emitSessionFrame(input.transport, input.hostConfig, record, {
				type: "reset",
				value,
			});
			return { mode: "sync", value: { type: "reset" } };
		}
		case "snapshot": {
			validateResourceName(input.command.name, "snapshot name");
			if (
				await prototypeFileExists(
					input.hostConfig.prototypesDir,
					input.command.name,
				)
			) {
				throw new Error("prototype_exists");
			}
			await emitSessionFrame(input.transport, input.hostConfig, record, {
				type: "reset",
				value: {},
			});
			const imageTag = `sumeru/${input.command.name}:dev`;
			if (record.containerId === null) {
				throw new Error("session_not_running");
			}
			const source = input.hostConfig.prototypes.get(record.prototype);
			if (source === undefined) {
				throw new Error("prototype_not_found");
			}
			const prototype = { ...source.prototype, name: input.command.name };
			await input.transport.commit({
				containerId: record.containerId,
				tag: imageTag,
				labels: snapshotImageLabels(prototype),
			});
			await registerSnapshotPrototype(
				input.hostConfig,
				record.prototype,
				input.command.name,
				imageTag,
			);
			return {
				mode: "sync",
				value: {
					type: "snapshot",
					name: input.command.name,
					image: imageTag,
				},
			};
		}
	}
}

async function execInContainer(
	transport: Transport,
	record: ManagedSession,
	command: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	if (record.containerId === null) {
		throw new Error("session_not_running");
	}
	await ensureContainerRunning(transport, record.containerId);
	return transport.runOnce({
		containerId: record.containerId,
		command: ["sh", "-c", command],
		env: record.sessionEnv,
	});
}

async function ensureContainerRunning(
	transport: Transport,
	containerId: string,
): Promise<void> {
	const status = await transport.inspectStatus(containerId);
	if (status === "stopped") {
		await transport.start(containerId);
	}
}

async function emitSessionFrame(
	transport: Transport,
	hostConfig: LoadedHostConfig,
	record: ManagedSession,
	frame: Record<string, unknown>,
): Promise<void> {
	if (record.containerId === null) {
		throw new Error("session_not_running");
	}
	await ensureContainerRunning(transport, record.containerId);
	const prototype = hostConfig.prototypes.get(record.prototype);
	if (prototype === undefined) {
		throw new Error("prototype_not_found");
	}
	const session = transport.exec({
		containerId: record.containerId,
		command: defaultAdapterCommand(prototype.prototype.adapter),
		env: record.sessionEnv,
	});
	const readDone = readSessionFrameResponse(session.lines);
	session.stdin.write(`${JSON.stringify(frame)}\n`);
	session.stdin.end();
	await readDone;
}

async function readSessionFrameResponse(
	lines: AsyncIterable<string>,
): Promise<void> {
	for await (const line of lines) {
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}
		if (typeof parsed !== "object" || parsed === null || !("type" in parsed)) {
			continue;
		}
		const type = (parsed as { type: string }).type;
		if (type === "done" || type === "ready") {
			return;
		}
		if (type === "error") {
			const value = (parsed as { value?: { message?: string } }).value;
			throw new Error(value?.message ?? "session_command_failed");
		}
	}
	throw new Error("session_command_failed");
}

function resolveModelCommand(
	hostConfig: LoadedHostConfig,
	record: ManagedSession,
	provider: string,
	model: string,
): ManagedSession["model"] {
	const prototypeInfo = hostConfig.prototypes.get(record.prototype);
	const adapterName = prototypeInfo?.prototype.adapter ?? record.prototype;
	return resolveSessionModel(
		hostConfig.sqliteStore,
		prototypeInfo?.prototype.model ?? null,
		`${provider}:${model}`,
		getProviderMode(adapterName),
		hostConfig.config.defaults?.model ?? null,
	);
}

function resolveInstallSkill(
	hostConfig: LoadedHostConfig,
	command: Extract<SessionCommand, { type: "install-skill" }>,
): {
	name: string;
	content: string;
	files: Array<{ path: string; content: string }>;
} {
	if (command.content !== null) {
		return {
			name: command.name,
			content: command.content,
			files: command.files ?? [],
		};
	}
	const skill = hostConfig.sqliteStore.getSkill(command.name);
	if (skill === null) {
		throw new Error("skill_not_found");
	}
	return {
		name: skill.name,
		content: skill.content,
		files: command.files ?? [],
	};
}

async function registerSnapshotPrototype(
	hostConfig: LoadedHostConfig,
	sourcePrototypeName: string,
	snapshotName: string,
	imageTag: string,
): Promise<void> {
	const source = hostConfig.prototypes.get(sourcePrototypeName);
	if (source === undefined) {
		throw new Error("prototype_not_found");
	}
	const prototype = { ...source.prototype, name: snapshotName };
	await writePrototypeFile(hostConfig.prototypesDir, prototype);
	if (source.composePath !== null) {
		const composeRaw = await readFile(source.composePath, "utf-8");
		const updated = replaceComposeImage(composeRaw, imageTag);
		const composeDir = join(hostConfig.rootDir, "prototypes", snapshotName);
		await mkdir(composeDir, { recursive: true });
		await writeFile(join(composeDir, "compose.yaml"), updated);
	}
	await reloadPrototypeInConfig(hostConfig, snapshotName);
}

function replaceComposeImage(composeRaw: string, imageTag: string): string {
	const doc = parseYaml(composeRaw);
	if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
		return composeRaw;
	}
	const services = (doc as Record<string, unknown>).services;
	if (
		services === null ||
		typeof services !== "object" ||
		Array.isArray(services)
	) {
		return composeRaw;
	}
	for (const service of Object.values(services as Record<string, unknown>)) {
		if (
			service === null ||
			typeof service !== "object" ||
			Array.isArray(service)
		) {
			continue;
		}
		(service as Record<string, unknown>).image = imageTag;
	}
	return stringifyYaml(doc);
}

function modelBaseUrl(model: ManagedSession["model"]): string {
	if (typeof model.provider === "string") {
		switch (model.provider) {
			case "anthropic":
				return "https://api.anthropic.com";
			case "openai":
				return "https://api.openai.com/v1";
			case "openrouter":
				return "https://openrouter.ai/api/v1";
		}
	}
	return model.provider.endpoint;
}
