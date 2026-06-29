import type {
	HostConfig,
	Image,
	ModelConfig,
	Prototype,
	SessionInfo,
} from "@sumeru/core";
import type { TurnRecord } from "./ocas-recorder.js";

export type Envelope<T> = {
	type: string;
	value: T;
};

export type ErrorValue = {
	error: string;
	message: string;
};

export type HostRootValue = {
	name: string;
	version: string;
	status: {
		running: number;
		queued: number;
		idle: number;
	};
	uptime: number;
};

export type PrototypeInfo = {
	name: string;
	prototype: Prototype;
	yamlPath: string;
	prototypeHash: string;
	composePath: string | null;
};

export type LoadedHostConfig = {
	rootDir: string;
	configPath: string;
	dataDir: string;
	skillsDir: string;
	prototypesDir: string;
	config: HostConfig;
	prototypes: Map<string, PrototypeInfo>;
	images: Map<string, Image>;
};

export type ManagedSession = SessionInfo & {
	containerId: string | null;
	projectName: string;
	composePath: string;
	initVersion: string | null;
	projectPath: string;
	sessionEnv: Record<string, string>;
};

export type CreateSessionRequest = {
	prototype: string;
	project: string;
	task: string;
	model: {
		provider: ModelConfig["provider"];
		name: string;
	} | null;
	env: Record<string, string> | null;
};

export type SessionModelRequest = CreateSessionRequest["model"];

export type MessageBody = {
	content: string;
	env: Record<string, string> | null;
	model: SessionModelRequest | null;
};

export type MessageRequest = MessageBody & {
	messageId: string;
};

export type MessageAcceptedValue = {
	sessionId: string;
	messageId: string;
};

export type HistoryValue = {
	sessionId: string;
	total: number;
	offset: number;
	turns: Array<TurnRecord>;
};

export type SkillValue = {
	name: string;
	content: string;
};

export type TransportUpResult = {
	containerId: string;
};

export type TransportExecSession = {
	stdin: NodeJS.WritableStream;
	lines: AsyncIterable<string>;
	waitForExit(): Promise<{ exitCode: number | null; stderr: string }>;
};

export type Transport = {
	up(input: {
		projectName: string;
		composePath: string;
		workDir: string;
		projectPath: string;
		env: Record<string, string> | null;
	}): Promise<TransportUpResult>;
	down(input: {
		projectName: string;
		composePath: string;
		workDir: string;
	}): Promise<void>;
	rm(input: {
		projectName: string;
		composePath: string;
		workDir: string;
	}): Promise<void>;
	exec(input: {
		containerId: string;
		command: Array<string>;
		env: Record<string, string> | null;
	}): TransportExecSession;
	inspectStatus(containerId: string): Promise<"running" | "stopped">;
};

export type HostServerOptions = {
	hostConfig: LoadedHostConfig;
	transport: Transport;
	version: string;
};

export type RouteHandler = (
	req: import("node:http").IncomingMessage,
	res: import("node:http").ServerResponse,
	params: Record<string, string>,
	path: string,
	queryString: string,
) => void | Promise<void>;

export type MatchResult =
	| { type: "match"; handler: RouteHandler; params: Record<string, string> }
	| { type: "method_not_allowed"; allow: string }
	| { type: "not_found" };
