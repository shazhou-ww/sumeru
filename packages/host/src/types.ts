import type { AdapterManifest, ProviderMode } from "@sumeru/adapter-core";
import type {
	Extension,
	HostConfig,
	ModelConfig,
	Prototype,
	SessionInfo,
} from "@sumeru/core";
import type { TurnRecord } from "./ocas-recorder.js";
import type { SqliteStore } from "./sqlite-store.js";

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
	imageTag: string | null;
};

export type AdapterInfo = {
	name: string;
	providerMode: ProviderMode;
	credentialEnv: string | null;
	listModels: boolean;
};

export function toAdapterInfo(manifest: AdapterManifest): AdapterInfo {
	return {
		name: manifest.name,
		providerMode: manifest.providerMode,
		credentialEnv: manifest.credentialEnv,
		listModels: manifest.listModels !== null,
	};
}

export type LoadedHostConfig = {
	rootDir: string;
	configPath: string;
	dataDir: string;
	skillsDir: string;
	prototypesDir: string;
	extensionsDir: string;
	config: HostConfig;
	prototypes: Map<string, PrototypeInfo>;
	extensions: Map<string, Extension>;
	sqliteStore: SqliteStore;
};

export type ManagedSession = SessionInfo & {
	containerId: string | null;
	projectName: string;
	composePath: string | null;
	imageTag: string | null;
	initVersion: string | null;
	projectPath: string | null;
	sessionEnv: Record<string, string>;
};

export type SessionModelOverride =
	| string
	| { provider: ModelConfig["provider"]; name: string }
	| null;

export type CreateSessionRequest = {
	prototype: string;
	project: string | null;
	task: string | null;
	model: SessionModelOverride;
	env: Record<string, string> | null;
	reset?: boolean;
};

export type MessageBody = {
	content: string;
	env: Record<string, string> | null;
	model: SessionModelOverride;
};

export type MessageRequest = MessageBody & {
	messageId: string;
};

export type MessageAcceptedValue = {
	sessionId: string;
	messageId: string;
};

export type SessionCommand =
	| {
			type: "chat";
			content: string;
			messageId: string | null;
			env: Record<string, string> | null;
			model: SessionModelOverride;
	  }
	| { type: "exec"; command: string }
	| { type: "model"; model: string }
	| {
			type: "install-skill";
			name: string;
			content: string | null;
			files: Array<{ path: string; content: string }> | null;
	  }
	| { type: "reset"; persona: string | null }
	| { type: "snapshot"; name: string };

export type CommandAcceptedValue = {
	sessionId: string;
	commandId: string;
};

export type CommandResultValue =
	| { type: "exec"; stdout: string; stderr: string; exitCode: number }
	| { type: "model"; model: string }
	| { type: "install-skill"; name: string }
	| { type: "reset" }
	| { type: "snapshot"; name: string; image: string };

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
		projectPath: string | null;
		env: Record<string, string> | null;
	}): Promise<TransportUpResult>;
	upFromImage(input: {
		containerName: string;
		imageTag: string;
		workDir: string;
		projectPath: string | null;
		cacheDir: string;
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
	rmContainer(containerId: string): Promise<void>;
	/** Stop container without removing it (preserves writable layer). */
	stop(containerId: string): Promise<void>;
	/** Start a previously stopped container. */
	start(containerId: string): Promise<void>;
	exec(input: {
		containerId: string;
		command: Array<string>;
		env: Record<string, string> | null;
	}): TransportExecSession;
	runOnce(input: {
		containerId: string;
		command: Array<string>;
		env: Record<string, string> | null;
	}): Promise<{ stdout: string; stderr: string; exitCode: number }>;
	commit(input: {
		containerId: string;
		tag: string;
		labels: Record<string, string> | null;
	}): Promise<{ imageId: string }>;
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
