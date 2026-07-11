import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer as createHttpServer } from "node:http";
import { loadHostConfig } from "./config.js";
import {
	createAdaptersHandler,
	createCommandsHandler,
	createEventsHandler,
	createExportHandler,
	createExtensionsHandler,
	createHistoryHandler,
	createMessagesHandler,
	createModelsHandler,
	createPersonasHandler,
	createPrototypesHandler,
	createProvidersHandler,
	createRootHandler,
	createSearchHandler,
	createSessionsHandler,
	createSkillsHandler,
	createTurnsHandler,
	writeMethodNotAllowed,
	writeRouteNotFound,
} from "./handlers/index.js";
import { createRouter } from "./router.js";
import { createSessionManager } from "./session-manager.js";
import { createDockerTransport } from "./transport.js";
import type {
	HostServerOptions,
	LoadedHostConfig,
	Transport,
} from "./types.js";

export const VERSION = "0.3.2";

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
	manager: ReturnType<typeof createSessionManager>;
	version: string;
}): (req: IncomingMessage, res: ServerResponse) => void {
	const adapters = createAdaptersHandler(input.hostConfig);
	const prototypes = createPrototypesHandler(input.hostConfig);
	const extensions = createExtensionsHandler(input.hostConfig);
	const providers = createProvidersHandler(input.hostConfig);
	const models = createModelsHandler(input.hostConfig);
	const personas = createPersonasHandler(input.hostConfig);
	const skills = createSkillsHandler(input.hostConfig);
	const sessions = createSessionsHandler(input.manager);
	const router = createRouter({
		methodNotAllowed: writeMethodNotAllowed,
		notFound: writeRouteNotFound,
	})
		.route("GET", "/", createRootHandler(input))
		.route("GET", "/adapters", adapters.list)
		.route("GET", "/adapters/:name", adapters.get)
		.route("GET", "/adapters/:name/models", adapters.models)
		.route("GET", "/prototypes", prototypes.list)
		.route("GET", "/prototypes/:name", prototypes.get)
		.route("PUT", "/prototypes/:name", prototypes.upsert)
		.route("DELETE", "/prototypes/:name", prototypes.remove)
		.route("GET", "/extensions", extensions.list)
		.route("GET", "/extensions/:name", extensions.get)
		.route("PUT", "/extensions/:name", extensions.upsert)
		.route("DELETE", "/extensions/:name", extensions.remove)
		.route("GET", "/providers", providers.list)
		.route("GET", "/providers/:name", providers.get)
		.route("PUT", "/providers/:name", providers.upsert)
		.route("DELETE", "/providers/:name", providers.remove)
		.route("GET", "/providers/:name/models", providers.models)
		.route("GET", "/providers/:name/models/:modelName", models.get)
		.route("PUT", "/providers/:name/models/:modelName", models.upsert)
		.route("DELETE", "/providers/:name/models/:modelName", models.remove)
		.route("GET", "/models", models.listAll)
		.route("GET", "/personas", personas.list)
		.route("GET", "/personas/:name", personas.get)
		.route("PUT", "/personas/:name", personas.upsert)
		.route("DELETE", "/personas/:name", personas.remove)
		.route("GET", "/skills/:name", skills.get)
		.route("PUT", "/skills/:name", skills.put)
		.route("DELETE", "/skills/:name", skills.remove)
		.route("GET", "/sessions", sessions.list)
		.route("POST", "/sessions", sessions.add)
		.route("GET", "/sessions/:id", sessions.get)
		.route("POST", "/sessions/:id/stop", sessions.stop)
		.route("DELETE", "/sessions/:id", sessions.remove)
		.route(
			"POST",
			"/sessions/:id/commands",
			createCommandsHandler(input.manager),
		)
		.route(
			"POST",
			"/sessions/:id/messages",
			createMessagesHandler(input.manager),
		)
		.route("GET", "/sessions/:id/events", createEventsHandler(input.manager))
		.route("GET", "/sessions/:id/history", createHistoryHandler(input.manager))
		.route("GET", "/sessions/:id/turns", createTurnsHandler(input.manager))
		.route(
			"POST",
			"/sessions/:id/export",
			createExportHandler(input.manager, input.hostConfig.dataDir),
		)
		.route("GET", "/search", createSearchHandler(input.hostConfig.dataDir));

	return (req, res) => {
		router.handle(req, res);
	};
}

export async function startHost(config: StartHostConfig): Promise<StartedHost> {
	const hostConfig = await loadHostConfig(config.rootDir);
	const transport = config.transport ?? createDockerTransport();
	const manager = createSessionManager({ hostConfig, transport });
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
				stop: async () => {
					await manager.destroyAll();
					await new Promise<void>((res, rej) => {
						server.close((err) => {
							if (err) rej(err);
							else res();
						});
					});
				},
			});
		};
		server.once("error", onError);
		server.once("listening", onListening);
		server.listen(config.port, config.host);
	});
}

export type { HostServerOptions, LoadedHostConfig, Transport };
