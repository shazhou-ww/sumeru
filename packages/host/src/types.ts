import type { AdapterInitConfig } from "@sumeru/adapter-core";
import type {
	HostConfig,
	InstanceId,
	InstanceInfo,
	InstanceStatus,
	Manifest,
	OutboxFrame,
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
	master: InstanceId;
	prototypes: Array<string>;
	instances: Array<InstanceId>;
};

export type PrototypeInfo = {
	name: string;
	adapter: string;
	manifest: Manifest;
	composePath: string;
	manifestPath: string;
	prototypeHash: string;
};

export type LoadedHostConfig = {
	rootDir: string;
	configPath: string;
	prototypesDir: string;
	dataDir: string;
	config: HostConfig;
	prototypes: Map<string, PrototypeInfo>;
	masterHash: string;
};

export type ManagedInstance = InstanceInfo & {
	containerId: string | null;
	projectName: string;
	composePath: string;
	initVersion: string | null;
};

export type CreateInstanceRequest = {
	prototype: string;
	projects: Array<string> | null;
};

export type InboxBody = {
	content: string;
	project: string | null;
};

export type InboxRequest = InboxBody & {
	messageId: string;
};

export type InboxAcceptedValue = {
	instanceId: InstanceId;
	messageId: string;
};

export type InstanceStatusValue = {
	id: InstanceId;
	status: InstanceStatus;
	containerId: string | null;
};

export type HistoryValue = {
	instanceId: InstanceId;
	total: number;
	offset: number;
	turns: Array<TurnRecord>;
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
	}): TransportExecSession;
	inspectStatus(containerId: string): Promise<InstanceStatus>;
};

export type AdapterBridge = {
	initConfig: AdapterInitConfig;
	initialized: boolean;
	session: TransportExecSession | null;
	frameSubscribers: Set<(frame: OutboxFrame) => void>;
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
