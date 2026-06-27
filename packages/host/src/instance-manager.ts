import { join } from "node:path";
import type { AdapterInitConfig } from "@sumeru/adapter-core";
import type {
	InboxMessage,
	InstanceId,
	InstanceInfo,
	InstanceStatus,
	OutboxFrame,
} from "@sumeru/core";
import { loadPrototypeInitSkills } from "./config.js";
import {
	generateInstanceId,
	MASTER_INSTANCE_ID,
	projectNameFromInstanceId,
} from "./id.js";
import { parseOutboxLine } from "./outbox.js";
import { defaultAdapterCommand } from "./transport.js";
import type {
	CreateInstanceRequest,
	InboxRequest,
	LoadedHostConfig,
	ManagedInstance,
	Transport,
} from "./types.js";

type AdapterRuntime = {
	initConfig: AdapterInitConfig;
	initialized: boolean;
	readTask: Promise<void> | null;
	subscribers: Set<(frame: OutboxFrame) => void>;
	session: {
		stdin: NodeJS.WritableStream;
		waitForExit(): Promise<{ exitCode: number | null; stderr: string }>;
	} | null;
};

export type InstanceManager = {
	listInstances(): Array<InstanceInfo>;
	getInstance(id: InstanceId): ManagedInstance | null;
	createInstance(body: CreateInstanceRequest): Promise<ManagedInstance>;
	deleteInstance(id: InstanceId): Promise<void>;
	resetInstance(id: InstanceId): Promise<ManagedInstance>;
	getStatus(id: InstanceId): Promise<InstanceStatus>;
	submitInbox(id: InstanceId, body: InboxRequest): Promise<void>;
	subscribeOutbox(
		id: InstanceId,
		onFrame: (frame: OutboxFrame) => void,
	): () => void;
	hostRoot(): {
		name: string;
		master: InstanceId;
		prototypes: Array<string>;
		instances: Array<InstanceId>;
	};
};

export function createInstanceManager(input: {
	hostConfig: LoadedHostConfig;
	transport: Transport;
}): InstanceManager {
	const instances = new Map<InstanceId, ManagedInstance>();
	const adapters = new Map<InstanceId, AdapterRuntime>();

	const master: ManagedInstance = {
		id: MASTER_INSTANCE_ID,
		prototype: null,
		status: "running",
		createdAt: new Date().toISOString(),
		projects: [],
		containerId: null,
		projectName: projectNameFromInstanceId(MASTER_INSTANCE_ID),
		composePath: "",
	};
	instances.set(MASTER_INSTANCE_ID, master);

	function listInstances(): Array<InstanceInfo> {
		return [...instances.values()].map(toInstanceInfo);
	}

	function getInstance(id: InstanceId): ManagedInstance | null {
		return instances.get(id) ?? null;
	}

	async function createInstance(
		body: CreateInstanceRequest,
	): Promise<ManagedInstance> {
		const childCount = [...instances.values()].filter(
			(item) => item.id !== MASTER_INSTANCE_ID,
		).length;
		if (childCount >= input.hostConfig.config.resources.maxInstances) {
			throw new Error("max_instances_reached");
		}
		const prototype = input.hostConfig.prototypes.get(body.prototype);
		if (prototype === undefined) {
			throw new Error("prototype_not_found");
		}
		const id = generateInstanceId();
		const projectName = projectNameFromInstanceId(id);
		const up = await input.transport.up({
			projectName,
			composePath: prototype.composePath,
			workDir: input.hostConfig.rootDir,
		});
		const record: ManagedInstance = {
			id,
			prototype: body.prototype,
			status: "running",
			createdAt: new Date().toISOString(),
			projects: body.projects ?? [],
			containerId: up.containerId,
			projectName,
			composePath: prototype.composePath,
		};
		instances.set(id, record);
		return record;
	}

	async function deleteInstance(id: InstanceId): Promise<void> {
		if (id === MASTER_INSTANCE_ID) {
			throw new Error("cannot_delete_master");
		}
		const record = instances.get(id);
		if (record === undefined) {
			throw new Error("instance_not_found");
		}
		stopAdapter(id);
		await input.transport.down({
			projectName: record.projectName,
			composePath: record.composePath,
			workDir: input.hostConfig.rootDir,
		});
		await input.transport.rm({
			projectName: record.projectName,
			composePath: record.composePath,
			workDir: input.hostConfig.rootDir,
		});
		instances.delete(id);
	}

	async function resetInstance(id: InstanceId): Promise<ManagedInstance> {
		if (id === MASTER_INSTANCE_ID) {
			throw new Error("cannot_reset_master");
		}
		const record = instances.get(id);
		if (record === undefined) {
			throw new Error("instance_not_found");
		}
		stopAdapter(id);
		await input.transport.down({
			projectName: record.projectName,
			composePath: record.composePath,
			workDir: input.hostConfig.rootDir,
		});
		const up = await input.transport.up({
			projectName: record.projectName,
			composePath: record.composePath,
			workDir: input.hostConfig.rootDir,
		});
		const updated: ManagedInstance = {
			...record,
			containerId: up.containerId,
			status: "running",
		};
		instances.set(id, updated);
		return updated;
	}

	async function getStatus(id: InstanceId): Promise<InstanceStatus> {
		const record = instances.get(id);
		if (record === undefined) {
			throw new Error("instance_not_found");
		}
		if (record.containerId === null) {
			return record.status;
		}
		const status = await input.transport.inspectStatus(record.containerId);
		record.status = status;
		return status;
	}

	async function submitInbox(
		id: InstanceId,
		body: InboxRequest,
	): Promise<void> {
		const record = instances.get(id);
		if (record === undefined) {
			throw new Error("instance_not_found");
		}
		if (id === MASTER_INSTANCE_ID) {
			throw new Error("master_has_no_inbox");
		}
		if (record.containerId === null) {
			throw new Error("instance_not_running");
		}
		const message: InboxMessage = {
			messageId: body.messageId,
			content: body.content,
			project: body.project,
		};
		await ensureAdapterReady(id, record);
		const runtime = adapters.get(id);
		if (runtime === null || runtime === undefined || runtime.session === null) {
			throw new Error("adapter_unavailable");
		}
		runtime.session.stdin.write(
			`${JSON.stringify({ type: "message", value: message })}\n`,
		);
	}

	function subscribeOutbox(
		id: InstanceId,
		onFrame: (frame: OutboxFrame) => void,
	): () => void {
		const record = instances.get(id);
		if (record === undefined) {
			throw new Error("instance_not_found");
		}
		if (id === MASTER_INSTANCE_ID) {
			throw new Error("master_has_no_outbox");
		}
		let runtime = adapters.get(id);
		if (runtime === undefined) {
			runtime = {
				initConfig: { instructions: "", skills: [], model: placeholderModel() },
				initialized: false,
				readTask: null,
				subscribers: new Set(),
				session: null,
			};
			adapters.set(id, runtime);
		}
		runtime.subscribers.add(onFrame);
		return () => {
			runtime?.subscribers.delete(onFrame);
		};
	}

	async function ensureAdapterReady(
		id: InstanceId,
		record: ManagedInstance,
	): Promise<void> {
		let runtime = adapters.get(id);
		if (runtime === undefined) {
			runtime = {
				initConfig: await buildInitConfig(record.prototype as string),
				initialized: false,
				readTask: null,
				subscribers: new Set(),
				session: null,
			};
			adapters.set(id, runtime);
		}
		if (runtime.session !== null && runtime.initialized) {
			return;
		}
		if (record.containerId === null) {
			throw new Error("instance_not_running");
		}
		const session = input.transport.exec({
			containerId: record.containerId,
			command: defaultAdapterCommand(),
		});
		runtime.session = session;
		runtime.readTask = readAdapterOutput(id, session.lines);
		runtime.session.stdin.write(
			`${JSON.stringify({ type: "init", value: runtime.initConfig })}\n`,
		);
		await waitForReady(id);
	}

	async function waitForReady(id: InstanceId): Promise<void> {
		const deadline = Date.now() + 30_000;
		while (Date.now() < deadline) {
			const runtime = adapters.get(id);
			if (runtime?.initialized === true) return;
			await sleep(20);
		}
		throw new Error("adapter_ready_timeout");
	}

	async function readAdapterOutput(
		id: InstanceId,
		lines: AsyncIterable<string>,
	): Promise<void> {
		const runtime = adapters.get(id);
		if (runtime === undefined) return;
		try {
			for await (const line of lines) {
				let parsed: unknown;
				try {
					parsed = JSON.parse(line);
				} catch {
					continue;
				}
				if (
					typeof parsed === "object" &&
					parsed !== null &&
					"type" in parsed &&
					(parsed as { type: string }).type === "ready"
				) {
					runtime.initialized = true;
					continue;
				}
				const frame = parseOutboxLine(line);
				if (frame === null) continue;
				for (const subscriber of runtime.subscribers) {
					subscriber(frame);
				}
			}
		} catch {
			const errorFrame: OutboxFrame = {
				type: "error",
				value: { code: "adapter_io_error", message: "adapter stdout closed" },
			};
			for (const subscriber of runtime.subscribers) {
				subscriber(errorFrame);
			}
		}
	}

	function stopAdapter(id: InstanceId): void {
		const runtime = adapters.get(id);
		if (runtime === undefined) return;
		if (runtime.session !== null) {
			runtime.session.stdin.end();
		}
		adapters.delete(id);
	}

	async function buildInitConfig(
		prototypeName: string,
	): Promise<AdapterInitConfig> {
		const prototype = input.hostConfig.prototypes.get(prototypeName);
		if (prototype === undefined) {
			throw new Error("prototype_not_found");
		}
		const prototypeDir = join(input.hostConfig.prototypesDir, prototypeName);
		const skills = await loadPrototypeInitSkills(
			prototypeDir,
			prototype.manifest,
		);
		return {
			instructions: prototype.manifest.instructions,
			skills,
			model: prototype.manifest.model,
		};
	}

	function hostRoot(): {
		name: string;
		master: InstanceId;
		prototypes: Array<string>;
		instances: Array<InstanceId>;
	} {
		return {
			name: input.hostConfig.config.name,
			master: MASTER_INSTANCE_ID,
			prototypes: [...input.hostConfig.prototypes.keys()],
			instances: [...instances.keys()],
		};
	}

	return {
		listInstances,
		getInstance,
		createInstance,
		deleteInstance,
		resetInstance,
		getStatus,
		submitInbox,
		subscribeOutbox,
		hostRoot,
	};
}

function toInstanceInfo(record: ManagedInstance): InstanceInfo {
	return {
		id: record.id,
		prototype: record.prototype,
		status: record.status,
		createdAt: record.createdAt,
		projects: record.projects,
	};
}

function placeholderModel(): AdapterInitConfig["model"] {
	return {
		provider: "anthropic",
		name: "placeholder",
		apiKeyEnv: "ANTHROPIC_API_KEY",
		contextWindow: 200_000,
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
