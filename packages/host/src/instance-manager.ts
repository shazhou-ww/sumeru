import { join } from "node:path";
import type { AdapterInitConfig } from "@sumeru/adapter-core";
import type {
	InboxMessage,
	InstanceId,
	InstanceInfo,
	InstanceStatus,
	OutboxFrame,
} from "@sumeru/core";
import {
	buildMasterInitConfig,
	loadPrototypeInitSkills,
	resolveMasterAdapterCommand,
} from "./config.js";
import {
	generateInstanceId,
	MASTER_INSTANCE_ID,
	projectNameFromInstanceId,
} from "./id.js";
import { LOCAL_MASTER_HANDLE } from "./local-transport.js";
import { createOcasRecorder, type OcasRecorder } from "./ocas-recorder.js";
import { outboxFrameToSseEvent, parseOutboxLine } from "./outbox.js";
import {
	createSseBuffer,
	type SseBuffer,
	type SseEvent,
} from "./sse-buffer.js";
import { defaultAdapterCommand } from "./transport.js";
import type {
	CreateInstanceRequest,
	HistoryValue,
	InboxRequest,
	LoadedHostConfig,
	ManagedInstance,
	Transport,
} from "./types.js";

type AdapterRuntime = {
	initConfig: AdapterInitConfig;
	initialized: boolean;
	readTask: Promise<void> | null;
	subscribers: Set<(event: SseEvent) => void>;
	sseBuffer: SseBuffer;
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
		onEvent: (event: SseEvent) => void,
	): () => void;
	getSseBuffer(id: InstanceId): SseBuffer;
	getHistory(id: InstanceId, limit: number, offset: number): HistoryValue;
	bootMaster(): Promise<void>;
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
	recorder?: OcasRecorder;
}): InstanceManager {
	const instances = new Map<InstanceId, ManagedInstance>();
	const adapters = new Map<InstanceId, AdapterRuntime>();
	const recorder =
		input.recorder ?? createOcasRecorder(input.hostConfig.dataDir);

	const master: ManagedInstance = {
		id: MASTER_INSTANCE_ID,
		prototype: null,
		status: "running",
		createdAt: new Date().toISOString(),
		projects: [],
		containerId: null,
		projectName: projectNameFromInstanceId(MASTER_INSTANCE_ID),
		composePath: "",
		initVersion: null,
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
		const runningCount = [...instances.values()].filter(
			(item) => item.id !== MASTER_INSTANCE_ID && item.status === "running",
		).length;
		if (runningCount >= input.hostConfig.config.resources.maxInstances) {
			throw new Error("resource_exhausted");
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
			initVersion: null,
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
		if (record.prototype === null) {
			throw new Error("prototype_not_found");
		}
		const prototype = input.hostConfig.prototypes.get(record.prototype);
		if (prototype === undefined) {
			throw new Error("prototype_not_found");
		}
		stopAdapter(id);
		await input.transport.down({
			projectName: record.projectName,
			composePath: record.composePath,
			workDir: input.hostConfig.rootDir,
		});
		recorder.clear(id);
		const up = await input.transport.up({
			projectName: record.projectName,
			composePath: prototype.composePath,
			workDir: input.hostConfig.rootDir,
		});
		const updated: ManagedInstance = {
			...record,
			containerId: up.containerId,
			composePath: prototype.composePath,
			initVersion: null,
			status: "stopped",
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
			`${JSON.stringify({
				type: "message",
				value: message,
			})}\n`,
		);
		recorder.record(id, {
			type: "turn",
			value: {
				index: recorder.getTurnTotal(id),
				role: "user",
				content: body.content,
				timestamp: new Date().toISOString(),
				toolCalls: null,
				tokens: null,
			},
		});
		if (record.status === "suspended") {
			record.status = "running";
		}
	}

	function getSseBuffer(id: InstanceId): SseBuffer {
		const record = instances.get(id);
		if (record === undefined) {
			throw new Error("instance_not_found");
		}
		return ensureAdapterRuntime(id).sseBuffer;
	}

	function subscribeOutbox(
		id: InstanceId,
		onEvent: (event: SseEvent) => void,
	): () => void {
		const runtime = ensureAdapterRuntime(id);
		runtime.subscribers.add(onEvent);
		return () => {
			runtime.subscribers.delete(onEvent);
		};
	}

	function ensureAdapterRuntime(id: InstanceId): AdapterRuntime {
		const record = instances.get(id);
		if (record === undefined) {
			throw new Error("instance_not_found");
		}
		let runtime = adapters.get(id);
		if (runtime === undefined) {
			runtime = createAdapterRuntime();
			adapters.set(id, runtime);
		}
		return runtime;
	}

	function appendOutboxEvent(
		runtime: AdapterRuntime,
		frame: OutboxFrame,
		instanceId: InstanceId,
	): SseEvent {
		recorder.record(instanceId, frame);
		const mapped = outboxFrameToSseEvent(frame);
		const event = runtime.sseBuffer.append({
			event: mapped.event,
			data: JSON.stringify(mapped.data),
		});
		for (const subscriber of runtime.subscribers) {
			subscriber(event);
		}
		return event;
	}

	async function ensureAdapterReady(
		id: InstanceId,
		record: ManagedInstance,
	): Promise<void> {
		if (id === MASTER_INSTANCE_ID) {
			await ensureMasterAdapterReady(id, record);
			return;
		}
		if (record.prototype === null) {
			throw new Error("prototype_not_found");
		}
		const currentHash = getPrototypeHash(record.prototype);
		let runtime = adapters.get(id);
		if (runtime === undefined) {
			runtime = createAdapterRuntime(await buildInitConfig(record.prototype));
			adapters.set(id, runtime);
		}
		const versionStale = record.initVersion !== currentHash;
		if (
			versionStale &&
			runtime.session !== null &&
			runtime.initialized &&
			record.status !== "suspended"
		) {
			await invalidateAdapterSession(runtime, record.prototype);
		}
		if (
			runtime.session !== null &&
			runtime.initialized &&
			record.status !== "suspended" &&
			!versionStale
		) {
			return;
		}
		if (record.containerId === null) {
			throw new Error("instance_not_running");
		}
		if (versionStale) {
			runtime.initConfig = await buildInitConfig(record.prototype);
		}
		runtime.initialized = false;
		const session = input.transport.exec({
			containerId: record.containerId,
			command: defaultAdapterCommand(),
		});
		runtime.session = session;
		const activeSession = session;
		runtime.readTask = readAdapterOutput(id, session.lines, activeSession);
		runtime.session.stdin.write(
			`${JSON.stringify({ type: "init", value: runtime.initConfig })}\n`,
		);
		await waitForReady(id);
		record.initVersion = currentHash;
	}

	async function ensureMasterAdapterReady(
		id: InstanceId,
		record: ManagedInstance,
	): Promise<void> {
		const currentHash = input.hostConfig.masterHash;
		let runtime = adapters.get(id);
		if (runtime === undefined) {
			runtime = createAdapterRuntime(buildMasterInitConfig(input.hostConfig));
			adapters.set(id, runtime);
		}
		const versionStale = record.initVersion !== currentHash;
		if (
			versionStale &&
			runtime.session !== null &&
			runtime.initialized &&
			record.status !== "suspended"
		) {
			await invalidateMasterAdapterSession(runtime);
		}
		if (
			runtime.session !== null &&
			runtime.initialized &&
			record.status !== "suspended" &&
			!versionStale
		) {
			return;
		}
		if (record.containerId === null) {
			throw new Error("instance_not_running");
		}
		if (versionStale) {
			runtime.initConfig = buildMasterInitConfig(input.hostConfig);
		}
		runtime.initialized = false;
		const session = input.transport.exec({
			containerId: record.containerId,
			command: resolveMasterAdapterCommand(input.hostConfig),
		});
		runtime.session = session;
		const activeSession = session;
		runtime.readTask = readAdapterOutput(id, session.lines, activeSession);
		runtime.session.stdin.write(
			`${JSON.stringify({ type: "init", value: runtime.initConfig })}\n`,
		);
		await waitForReady(id);
		record.initVersion = currentHash;
	}

	async function invalidateMasterAdapterSession(
		runtime: AdapterRuntime,
	): Promise<void> {
		if (runtime.session !== null) {
			runtime.session.stdin.end();
			runtime.session = null;
		}
		runtime.initialized = false;
		runtime.initConfig = buildMasterInitConfig(input.hostConfig);
	}

	async function invalidateAdapterSession(
		runtime: AdapterRuntime,
		prototypeName: string,
	): Promise<void> {
		if (runtime.session !== null) {
			runtime.session.stdin.end();
			runtime.session = null;
		}
		runtime.initialized = false;
		runtime.initConfig = await buildInitConfig(prototypeName);
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
		activeSession: NonNullable<AdapterRuntime["session"]>,
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
				if (frame.type === "suspend") {
					const record = instances.get(id);
					if (record !== undefined) {
						record.status = "suspended";
					}
					runtime.session = null;
					runtime.initialized = false;
				}
				appendOutboxEvent(runtime, frame, id);
			}
		} catch {
			const errorFrame: OutboxFrame = {
				type: "error",
				value: { code: "adapter_io_error", message: "adapter stdout closed" },
			};
			appendOutboxEvent(runtime, errorFrame, id);
		} finally {
			if (runtime.session === activeSession) {
				runtime.session = null;
				runtime.initialized = false;
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

	function getPrototypeHash(prototypeName: string): string {
		const prototype = input.hostConfig.prototypes.get(prototypeName);
		if (prototype === undefined) {
			throw new Error("prototype_not_found");
		}
		return prototype.prototypeHash;
	}

	function getHistory(
		id: InstanceId,
		limit: number,
		offset: number,
	): HistoryValue {
		const record = instances.get(id);
		if (record === undefined) {
			throw new Error("instance_not_found");
		}
		return {
			instanceId: id,
			total: recorder.getTurnTotal(id),
			offset,
			turns: recorder.getTurns(id, limit, offset),
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

	async function bootMaster(): Promise<void> {
		const master = instances.get(MASTER_INSTANCE_ID);
		if (master === undefined) return;
		const up = await input.transport.up({
			projectName: master.projectName,
			composePath: master.composePath,
			workDir: input.hostConfig.rootDir,
		});
		master.containerId = up.containerId;
		master.status = "running";
		if (up.containerId === LOCAL_MASTER_HANDLE) {
			master.status = "running";
		}
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
		getSseBuffer,
		getHistory,
		bootMaster,
		hostRoot,
	};
}

function createAdapterRuntime(
	initConfig: AdapterInitConfig = {
		instructions: "",
		skills: [],
		model: placeholderModel(),
	},
): AdapterRuntime {
	return {
		initConfig,
		initialized: false,
		readTask: null,
		subscribers: new Set(),
		sseBuffer: createSseBuffer(),
		session: null,
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
