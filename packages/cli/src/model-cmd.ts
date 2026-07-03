import {
	ApiClientError,
	createApiClient,
	resolveApiBaseUrl,
} from "./api-client.js";

export async function runSessionModelCommand(
	argv: Array<string>,
): Promise<number | null> {
	if (argv[0] !== "model" || argv.length < 3) {
		return null;
	}
	const sub = argv[1];
	if (
		sub === "list" ||
		sub === "get" ||
		sub === "add" ||
		sub === "update" ||
		sub === "remove"
	) {
		return null;
	}
	const sessionId = sub;
	const modelId = argv[2];
	const idx = modelId.indexOf(":");
	if (idx === -1) {
		process.stderr.write("Invalid model ID. Expected format: provider:model\n");
		return 1;
	}
	const provider = modelId.slice(0, idx);
	const model = modelId.slice(idx + 1);
	if (provider.length === 0 || model.length === 0) {
		process.stderr.write("Invalid model ID. Expected format: provider:model\n");
		return 1;
	}
	const hostFlag = argv.indexOf("--host");
	const portFlag = argv.indexOf("--port");
	const api = createApiClient(
		resolveApiBaseUrl({
			host: hostFlag >= 0 ? argv[hostFlag + 1] : undefined,
			port: portFlag >= 0 ? argv[portFlag + 1] : undefined,
		}),
	);
	try {
		const result = await api.postCommand(sessionId, {
			type: "model",
			provider,
			model,
		});
		if (result.mode !== "sync" || result.value.type !== "model") {
			process.stderr.write("Expected sync model result\n");
			return 1;
		}
		process.stdout.write(`${result.value.provider}:${result.value.model}\n`);
		return 0;
	} catch (err) {
		if (err instanceof ApiClientError) {
			process.stderr.write(`${err.code}: ${err.message}\n`);
			return 1;
		}
		const msg = err instanceof Error ? err.message : String(err);
		process.stderr.write(`${msg}\n`);
		return 1;
	}
}
