import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createHttpServer } from "node:http";
import { loadHostConfig, resolveMasterAdapterCommand } from "./config.js";
import {
	createHistoryHandler,
	createInboxHandler,
	createInstancesHandler,
	createOutboxHandler,
	createPrototypesHandler,
	createRootHandler,
	writeMethodNotAllowed,
	writeRouteNotFound,
} from "./handlers/index.js";
import { projectNameFromInstanceId } from "./id.js";
import { createInstanceManager } from "./instance-manager.js";
import {
	createLocalTransport,
	createRoutingTransport,
} from "./local-transport.js";
import { createRouter } from "./router.js";
import { createDockerTransport } from "./transport.js";
import type {
	HostServerOptions,
	LoadedHostConfig,
	Transport,
} from "./types.js";

export const VERSION = "0.1.0";

export type StartHostConfig = {
	rootDir: string;
	host: string;
	port: number;
	transport: Transport | null;
};

export type StartedHost = {
	host: string;
	port: number;
	stop(): Promise<void>;
};

export function createHostHandler(input: {
	hostConfig: LoadedHostConfig;
	manager: ReturnType<typeof createInstanceManager>;
	version: string;
}): (req: IncomingMessage, res: ServerResponse) => void {
	const prototypes = createPrototypesHandler(input.hostConfig);
	const instances = createInstancesHandler(input.manager);
	const router = createRouter({
		methodNotAllowed: writeMethodNotAllowed,
		notFound: writeRouteNotFound,
	})
		.route("GET", "/", createRootHandler(input))
		.route("GET", "/prototypes", prototypes.list)
		.route("GET", "/prototypes/:name", prototypes.detail)
		.route("GET", "/instances", instances.list)
		.route("POST", "/instances", instances.create)
		.route("DELETE", "/instances/:id", instances.remove)
		.route("GET", "/instances/:id/status", instances.status)
		.route("POST", "/instances/:id/reset", instances.reset)
		.route("POST", "/instances/:id/inbox", createInboxHandler(input.manager))
		.route("GET", "/instances/:id/outbox", createOutboxHandler(input.manager))
		.route(
			"GET",
			"/instances/:id/history",
			createHistoryHandler(input.manager),
		);

	return (req, res) => {
		router.handle(req, res);
	};
}

export async function startHost(config: StartHostConfig): Promise<StartedHost> {
	const hostConfig = await loadHostConfig(config.rootDir);
	const dockerTransport = config.transport ?? createDockerTransport();
	const localTransport = createLocalTransport({
		adapterCommand: resolveMasterAdapterCommand(hostConfig),
	});
	const transport = createRoutingTransport({
		docker: dockerTransport,
		local: localTransport,
		masterProjectName: projectNameFromInstanceId("inst_0"),
	});
	const manager = createInstanceManager({ hostConfig, transport });
	await manager.bootMaster();
	const handler = createHostHandler({
		hostConfig,
		manager,
		version: VERSION,
	});
	const server = createHttpServer(handler);
	return new Promise<StartedHost>((resolve, reject) => {
		const onError = (err: Error): void => {
			server.removeListener("listening", onListening);
			reject(err);
		};
		const onListening = (): void => {
			server.removeListener("error", onError);
			const address = server.address();
			if (address === null || typeof address === "string") {
				reject(new Error("Server bound to an unexpected address"));
				return;
			}
			resolve({
				host: config.host,
				port: address.port,
				stop: () =>
					new Promise<void>((res, rej) => {
						server.close((err) => {
							if (err) rej(err);
							else res();
						});
					}),
			});
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(config.port, config.host);
	});
}

export type { HostServerOptions, LoadedHostConfig, Transport };
