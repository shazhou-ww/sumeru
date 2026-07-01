import type {
	AdapterInitConfig,
	InboxMessage,
	OutboxFrame,
	TurnValue,
} from "@sumeru/adapter-core";
import type { ExitSignal, SessionInfo, TokenUsage, Turn } from "@sumeru/core";
import {
	extractImageFromCompose,
	loadPrototypeInitSkills,
	mergeSessionEnv,
	resolveProjectPath,
	resolveSessionModel,
} from "./config.js";
import {
	generateMessageId,
	generateSessionId,
	projectNameFromSessionId,
} from "./id.js";
import { createOcasRecorder, type OcasRecorder } from "./ocas-recorder.js";
import { parseOutboxLine } from "./outbox.js";
import {
	createSseBuffer,
	type SseBuffer,
	type SseEvent,
} from "./sse-buffer.js";
import { defaultAdapterCommand } from "./transport.js";
import type {
	CreateSessionRequest,
	HistoryValue,
	LoadedHostConfig,
	ManagedSession,
	MessageRequest,
	Transport,
} from "./types.js";
import { turnRecordsToV3, wireTurnsToV3 } from "./wire-turn.js";

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
	turnCount: number;
	tokenUsage: TokenUsage;
	startedAt: number;
	// Wall-clock timestamp (ms) of the most recent turn frame arrival, or null
	// before the first turn of the current send. Used to derive per-turn
	// durationMs as the delta from the previous boundary (#178).
	lastTurnAt: number | null;
	nextTurnEventId: number;
};

const EMPTY_TOKEN_USAGE: TokenUsage = { input: 0, output: 0, cached: 0 };

export type SessionManager = {
	listSessions(): Array<SessionInfo>;
	getSession(id: string): ManagedSession | null;
	createSession(body: CreateSessionRequest): Promise<ManagedSession>;
	stopSession(id: string): Promise<ManagedSession>;
	deleteSession(id: string): Promise<void>;
	submitMessage(id: string, body: MessageRequest): Promise<void>;
	subscribeEvents(id: string, onEvent: (event: SseEvent) => void): () => void;
	getSseBuffer(id: string): SseBuffer;
	getHistory(id: string, limit: number, offset: number): HistoryValue;
	getSessionTurns(id: string, after: number | null): Array<Turn>;
	hostRoot(): HostRootSnapshot;
	destroyAll(): Promise<void>;
};

export type HostRootSnapshot = {
	name: string;
	status: {
		running: number;
		queued: number;
		idle: number;
	};
	uptime: number;
};

export function createSessionManager(input: {
	hostConfig: LoadedHostConfig;
	transport: Transport;
	recorder?: OcasRecorder;
}): SessionManager {
	const sessions = new Map<string, ManagedSession>();
	const adapters = new Map<string, AdapterRuntime>();
	const slotWaiters: Array<() => void> = [];
	const startedAt = Date.now();
	const recorder =
		input.recorder ?? createOcasRecorder(input.hostConfig.dataDir);

	function listSessions(): Array<SessionInfo> {
		return [...sessions.values()].map((record) => {
			const runtime = adapters.get(record.id);
			const usage = runtime?.tokenUsage ?? record.tokenUsage;
			return toSessionInfo(record, usage);
		});
	}

	function getSession(id: string): ManagedSession | null {
		return sessions.get(id) ?? null;
	}

	function countRunning(): number {
		return [...sessions.values()].filter((item) => item.status === "running")
			.length;
	}

	async function waitForRunningSlot(): Promise<void> {
		while (countRunning() >= input.hostConfig.config.maxRunning) {
			await new Promise<void>((resolve) => {
				slotWaiters.push(resolve);
			});
		}
	}

	function releaseRunningSlot(): void {
		if (
			slotWaiters.length > 0 &&
			countRunning() < input.hostConfig.config.maxRunning
		) {
			const wake = slotWaiters.shift();
			wake?.();
		}
	}

	async function createSession(
		body: CreateSessionRequest,
	): Promise<ManagedSession> {
		const prototype = input.hostConfig.prototypes.get(body.prototype);
		if (prototype === undefined) {
			throw new Error("prototype_not_found");
		}
		if (prototype.composePath === null) {
			throw new Error("prototype_no_compose");
		}
		const projectResolution = resolveProjectPath(
			input.hostConfig.config.workspaceRoot,
			body.project,
		);
		if (!projectResolution.ok) {
			throw new Error(`invalid_project:${projectResolution.message}`);
		}
		const model = resolveSessionModel(
			input.hostConfig.sqliteStore,
			prototype.prototype.model,
			body.model,
		);
		const image = await extractImageFromCompose(prototype.composePath);
		const sessionEnv = mergeSessionEnv(
			input.hostConfig.config.envFile,
			body.env,
		);

		await waitForRunningSlot();
		const id = generateSessionId();
		const projectName = projectNameFromSessionId(id);
		try {
			const up = await input.transport.up({
				projectName,
				composePath: prototype.composePath,
				workDir: input.hostConfig.rootDir,
				projectPath: projectResolution.projectPath,
				env: sessionEnv,
			});
			const record: ManagedSession = {
				id,
				prototype: body.prototype,
				model,
				image,
				project: body.project,
				task: body.task,
				status: "running",
				exit: null,
				tokenUsage: null,
				createdAt: new Date().toISOString(),
				containerId: up.containerId,
				projectName,
				composePath: prototype.composePath,
				initVersion: null,
				projectPath: projectResolution.projectPath,
				sessionEnv,
			};
			sessions.set(id, record);
			await ensureAdapterReady(id, record);
			await sendTask(id, record, body.task);
			return record;
		} catch (err) {
			const record = sessions.get(id);
			if (record !== undefined) {
				stopAdapter(id);
				try {
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
				} catch {
					// best-effort cleanup
				}
				sessions.delete(id);
			}
			releaseRunningSlot();
			throw err;
		}
	}

	async function stopSession(id: string): Promise<ManagedSession> {
		const record = sessions.get(id);
		if (record === undefined) {
			throw new Error("session_not_found");
		}
		if (record.status === "idle") {
			throw new Error("session_already_idle");
		}
		const runtime = adapters.get(id);
		const exit = buildStoppedExit(runtime);
		stopAdapter(id);
		const updated: ManagedSession = {
			...record,
			status: "idle",
			exit,
			tokenUsage: exit.tokenUsage,
		};
		sessions.set(id, updated);
		releaseRunningSlot();
		return updated;
	}

	async function deleteSession(id: string): Promise<void> {
		const record = sessions.get(id);
		if (record === undefined) {
			throw new Error("session_not_found");
		}
		const wasRunning = record.status === "running";
		if (wasRunning) {
			stopAdapter(id);
		}
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
		sessions.delete(id);
		adapters.delete(id);
		recorder.clear(id);
		if (wasRunning) {
			releaseRunningSlot();
		}
	}

	async function submitMessage(
		id: string,
		body: MessageRequest,
	): Promise<void> {
		const record = sessions.get(id);
		if (record === undefined) {
			throw new Error("session_not_found");
		}
		if (record.status === "running") {
			throw new Error("session_busy");
		}
		if (record.containerId === null) {
			throw new Error("session_not_running");
		}

		if (body.env !== null) {
			for (const [key, value] of Object.entries(body.env)) {
				record.sessionEnv[key] = value;
			}
		}
		if (body.model !== null) {
			const prototypeInfo = input.hostConfig.prototypes.get(record.prototype);
			const protoModelId = prototypeInfo?.prototype.model ?? "";
			const nextModel = resolveSessionModel(
				input.hostConfig.sqliteStore,
				protoModelId,
				body.model,
			);
			if (modelConfigChanged(record.model, nextModel)) {
				record.model = nextModel;
				const runtime = adapters.get(id);
				if (runtime !== undefined) {
					await invalidateAdapterSession(
						runtime,
						record.prototype,
						record.model,
					);
				}
			}
		}

		await waitForRunningSlot();
		record.status = "running";
		record.exit = null;

		await deliverMessage(id, record, {
			messageId: body.messageId,
			content: body.content,
		});
	}

	async function deliverMessage(
		id: string,
		record: ManagedSession,
		body: { messageId: string; content: string },
	): Promise<void> {
		const message: InboxMessage = {
			messageId: body.messageId,
			content: body.content,
			project: record.projectPath,
		};
		await ensureAdapterReady(id, record);
		const runtime = adapters.get(id);
		if (runtime === null || runtime === undefined || runtime.session === null) {
			throw new Error("adapter_unavailable");
		}
		resetRuntimeStats(runtime);
		runtime.session.stdin.write(
			`${JSON.stringify({
				type: "message",
				value: message,
			})}\n`,
		);
		recorder.append(id, {
			type: "turn",
			value: {
				index: recorder.getTurnTotal(id),
				role: "user",
				content: body.content,
				timestamp: new Date().toISOString(),
				toolCalls: null,
				tokens: null,
				durationMs: null,
			},
		});
	}

	async function sendTask(
		id: string,
		record: ManagedSession,
		task: string,
	): Promise<void> {
		await deliverMessage(id, record, {
			messageId: generateMessageId(),
			content: task,
		});
	}

	function getSseBuffer(id: string): SseBuffer {
		const record = sessions.get(id);
		if (record === undefined) {
			throw new Error("session_not_found");
		}
		return ensureAdapterRuntime(id).sseBuffer;
	}

	function subscribeEvents(
		id: string,
		onEvent: (event: SseEvent) => void,
	): () => void {
		const runtime = ensureAdapterRuntime(id);
		runtime.subscribers.add(onEvent);
		return () => {
			runtime.subscribers.delete(onEvent);
		};
	}

	function ensureAdapterRuntime(id: string): AdapterRuntime {
		const record = sessions.get(id);
		if (record === undefined) {
			throw new Error("session_not_found");
		}
		let runtime = adapters.get(id);
		if (runtime === undefined) {
			runtime = createAdapterRuntime();
			adapters.set(id, runtime);
		}
		return runtime;
	}

	function appendTurnEvent(runtime: AdapterRuntime, turn: Turn): SseEvent {
		const event = runtime.sseBuffer.append({
			event: "turn",
			data: JSON.stringify(turn),
		});
		for (const subscriber of runtime.subscribers) {
			subscriber(event);
		}
		return event;
	}

	function appendExitEvent(
		runtime: AdapterRuntime,
		exit: ExitSignal,
	): SseEvent {
		const event = runtime.sseBuffer.append({
			event: "exit",
			data: JSON.stringify(exit),
		});
		for (const subscriber of runtime.subscribers) {
			subscriber(event);
		}
		return event;
	}

	function handleAdapterFrame(
		runtime: AdapterRuntime,
		frame: OutboxFrame,
		sessionId: string,
	): void {
		if (frame.type === "turn") {
			const stamped = stampTurnDuration(runtime, frame.value);
			recorder.append(sessionId, { type: "turn", value: stamped });
			trackTurn(runtime, stamped);
			const mapped = wireTurnsToV3(stamped, runtime.nextTurnEventId);
			runtime.nextTurnEventId = mapped.nextId;
			for (const turn of mapped.turns) {
				appendTurnEvent(runtime, turn);
			}
			return;
		}
		recorder.append(sessionId, frame);
		if (
			frame.type === "done" ||
			frame.type === "suspend" ||
			frame.type === "error"
		) {
			const exit = exitSignalFromFrame(runtime, frame);
			appendExitEvent(runtime, exit);
		}
	}

	// Derive the host-trusted wall-clock durationMs for a turn frame. The
	// adapter may already carry a measured durationMs (preferred); otherwise the
	// host measures the delta from the previous boundary — the prior turn's
	// arrival, or the send start (runtime.startedAt) for the first turn (#178).
	function stampTurnDuration(
		runtime: AdapterRuntime,
		value: TurnValue,
	): TurnValue {
		const now = Date.now();
		if (value.role !== "assistant") {
			runtime.lastTurnAt = now;
			return value;
		}
		const boundary = runtime.lastTurnAt ?? runtime.startedAt;
		runtime.lastTurnAt = now;
		if (value.durationMs !== null) {
			return value;
		}
		return { ...value, durationMs: Math.max(1, now - boundary) };
	}

	async function ensureAdapterReady(
		id: string,
		record: ManagedSession,
	): Promise<void> {
		const currentHash = getPrototypeHash(record.prototype);
		let runtime = adapters.get(id);
		if (runtime === undefined) {
			runtime = createAdapterRuntime(
				await buildInitConfig(record.prototype, record.model),
			);
			adapters.set(id, runtime);
		}
		const versionStale = record.initVersion !== currentHash;
		if (
			versionStale &&
			runtime.session !== null &&
			runtime.initialized &&
			record.status === "running"
		) {
			await invalidateAdapterSession(runtime, record.prototype, record.model);
		}
		if (
			runtime.session !== null &&
			runtime.initialized &&
			record.status === "running" &&
			!versionStale
		) {
			return;
		}
		if (record.containerId === null) {
			throw new Error("session_not_running");
		}
		if (versionStale) {
			runtime.initConfig = await buildInitConfig(
				record.prototype,
				record.model,
			);
		}
		runtime.initialized = false;
		const prototype = input.hostConfig.prototypes.get(record.prototype);
		if (prototype === undefined) {
			throw new Error("prototype_not_found");
		}
		const session = input.transport.exec({
			containerId: record.containerId,
			command: defaultAdapterCommand(prototype.name),
			env: record.sessionEnv,
		});
		runtime.session = session;
		const activeSession = session;
		resetRuntimeStats(runtime);
		runtime.readTask = readAdapterOutput(id, session.lines, activeSession);
		runtime.session.stdin.write(
			`${JSON.stringify({ type: "init", value: runtime.initConfig })}\n`,
		);
		await waitForReady(id);
		record.initVersion = currentHash;
	}

	async function invalidateAdapterSession(
		runtime: AdapterRuntime,
		prototypeName: string,
		model: ManagedSession["model"],
	): Promise<void> {
		if (runtime.session !== null) {
			runtime.session.stdin.end();
			runtime.session = null;
		}
		runtime.initialized = false;
		runtime.initConfig = await buildInitConfig(prototypeName, model);
	}

	async function waitForReady(id: string): Promise<void> {
		const deadline = Date.now() + 30_000;
		while (Date.now() < deadline) {
			const runtime = adapters.get(id);
			if (runtime?.initialized === true) return;
			await sleep(20);
		}
		throw new Error("adapter_ready_timeout");
	}

	async function readAdapterOutput(
		id: string,
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
				if (
					frame.type === "done" ||
					frame.type === "suspend" ||
					frame.type === "error"
				) {
					handleAdapterFrame(runtime, frame, id);
					markIdle(id, frame);
					runtime.session = null;
					runtime.initialized = false;
					continue;
				}
				handleAdapterFrame(runtime, frame, id);
			}
		} catch {
			const errorFrame: OutboxFrame = {
				type: "error",
				value: { code: "adapter_io_error", message: "adapter stdout closed" },
			};
			handleAdapterFrame(runtime, errorFrame, id);
			markIdle(id, errorFrame);
		} finally {
			if (runtime.session === activeSession) {
				runtime.session = null;
				runtime.initialized = false;
			}
		}
	}

	function markIdle(id: string, frame: OutboxFrame): void {
		const record = sessions.get(id);
		if (record === undefined || record.status !== "running") {
			return;
		}
		const runtime = adapters.get(id);
		const exit = exitSignalFromFrame(runtime, frame);
		const updated: ManagedSession = {
			...record,
			status: "idle",
			exit,
			tokenUsage: exit.tokenUsage,
		};
		sessions.set(id, updated);
		releaseRunningSlot();
	}

	function runtimeStats(runtime: AdapterRuntime | undefined): {
		elapsedMs: number;
		turnCount: number;
		tokenUsage: TokenUsage;
	} {
		if (runtime === undefined) {
			return {
				elapsedMs: 0,
				turnCount: 0,
				tokenUsage: { ...EMPTY_TOKEN_USAGE },
			};
		}
		return {
			elapsedMs: Math.max(0, Date.now() - runtime.startedAt),
			turnCount: runtime.turnCount,
			tokenUsage: { ...runtime.tokenUsage },
		};
	}

	function buildStoppedExit(runtime: AdapterRuntime | undefined): ExitSignal {
		return {
			...runtimeStats(runtime),
			type: "stopped",
		};
	}

	function exitSignalFromFrame(
		runtime: AdapterRuntime | undefined,
		frame: OutboxFrame,
	): ExitSignal {
		const base = runtimeStats(runtime);
		if (frame.type === "done") {
			return {
				elapsedMs: base.elapsedMs,
				turnCount: base.turnCount,
				tokenUsage: frame.value.tokenUsage ?? base.tokenUsage,
				type: "complete",
				message: frame.value.summary ?? "",
			};
		}
		if (frame.type === "suspend") {
			if (frame.value.reason === "timeout") {
				return {
					...base,
					elapsedMs: frame.value.elapsedMs,
					type: "timeout",
				};
			}
			const message =
				frame.value.reason === "permissionRequest"
					? "Permission required"
					: "Input required";
			return {
				...base,
				elapsedMs: frame.value.elapsedMs,
				type: "needsInput",
				message,
			};
		}
		if (frame.type === "error") {
			return {
				...base,
				type: "failed",
				message: frame.value.message,
			};
		}
		return {
			...base,
			type: "failed",
			message: "unknown adapter exit",
		};
	}

	function stopAdapter(id: string): void {
		const runtime = adapters.get(id);
		if (runtime === undefined) return;
		if (runtime.session !== null) {
			runtime.session.stdin.end();
		}
		adapters.delete(id);
	}

	async function buildInitConfig(
		prototypeName: string,
		model: ManagedSession["model"],
	): Promise<AdapterInitConfig> {
		const prototype = input.hostConfig.prototypes.get(prototypeName);
		if (prototype === undefined) {
			throw new Error("prototype_not_found");
		}
		const persona = input.hostConfig.sqliteStore.getPersona(
			prototype.prototype.persona,
		);
		if (persona === null) {
			throw new Error(`persona_not_found:${prototype.prototype.persona}`);
		}
		const skills = loadPrototypeInitSkills(
			input.hostConfig.sqliteStore,
			persona,
		);
		return {
			instructions: persona.instructions,
			skills,
			model,
		};
	}

	function getPrototypeHash(prototypeName: string): string {
		const prototype = input.hostConfig.prototypes.get(prototypeName);
		if (prototype === undefined) {
			throw new Error("prototype_not_found");
		}
		return prototype.prototypeHash;
	}

	function getHistory(id: string, limit: number, offset: number): HistoryValue {
		const record = sessions.get(id);
		if (record === undefined) {
			throw new Error("session_not_found");
		}
		return {
			sessionId: id,
			total: recorder.getTurnTotal(id),
			offset,
			turns: recorder.getTurns(id, limit, offset),
		};
	}

	function getSessionTurns(id: string, after: number | null): Array<Turn> {
		const record = sessions.get(id);
		if (record === undefined) {
			throw new Error("session_not_found");
		}
		const total = recorder.getTurnTotal(id);
		const records = recorder.getTurns(id, total, 0);
		const turns = turnRecordsToV3(records);
		if (after === null) {
			return turns;
		}
		return turns.filter((turn) => turn.id > after);
	}

	function hostRoot(): HostRootSnapshot {
		let running = 0;
		let idle = 0;
		for (const session of sessions.values()) {
			if (session.status === "running") {
				running += 1;
			} else {
				idle += 1;
			}
		}
		return {
			name: input.hostConfig.config.name,
			status: {
				running,
				queued: slotWaiters.length,
				idle,
			},
			uptime: Math.max(0, Date.now() - startedAt),
		};
	}

	async function destroyAll(): Promise<void> {
		const ids = [...sessions.keys()];
		await Promise.allSettled(
			ids.map(async (id) => {
				const record = sessions.get(id);
				if (record === undefined) return;
				stopAdapter(id);
				try {
					await input.transport.down({
						projectName: record.projectName,
						composePath: record.composePath,
						workDir: input.hostConfig.rootDir,
					});
				} catch {
					// best-effort: container may already be gone
				}
				sessions.delete(id);
				adapters.delete(id);
			}),
		);
	}

	return {
		listSessions,
		getSession,
		createSession,
		stopSession,
		deleteSession,
		submitMessage,
		subscribeEvents,
		getSseBuffer,
		getHistory,
		getSessionTurns,
		hostRoot,
		destroyAll,
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
		turnCount: 0,
		tokenUsage: { ...EMPTY_TOKEN_USAGE },
		startedAt: Date.now(),
		lastTurnAt: null,
		nextTurnEventId: 0,
	};
}

function modelConfigChanged(
	current: ManagedSession["model"],
	next: ManagedSession["model"],
): boolean {
	return (
		current.name !== next.name ||
		JSON.stringify(current.provider) !== JSON.stringify(next.provider) ||
		current.apiKey !== next.apiKey
	);
}

function resetRuntimeStats(runtime: AdapterRuntime): void {
	runtime.turnCount = 0;
	runtime.tokenUsage = { ...EMPTY_TOKEN_USAGE };
	runtime.startedAt = Date.now();
	runtime.lastTurnAt = null;
}

function trackTurn(runtime: AdapterRuntime, turn: TurnValue): void {
	if (turn.role === "assistant") {
		runtime.turnCount += 1;
	}
	if (turn.role !== "tool" && turn.tokens !== null) {
		runtime.tokenUsage = {
			input: runtime.tokenUsage.input + turn.tokens.input,
			output: runtime.tokenUsage.output + turn.tokens.output,
			cached: runtime.tokenUsage.cached + turn.tokens.cached,
		};
	}
}

function toSessionInfo(record: ManagedSession, tokenUsage: TokenUsage | null): SessionInfo {
	return {
		id: record.id,
		prototype: record.prototype,
		model: record.model,
		image: record.image,
		project: record.project,
		task: record.task,
		status: record.status,
		exit: record.exit,
		tokenUsage,
		createdAt: record.createdAt,
	};
}

function placeholderModel(): AdapterInitConfig["model"] {
	return {
		provider: "anthropic",
		name: "placeholder",
		apiKey: process.env.ANTHROPIC_API_KEY ?? null,
	};
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}
