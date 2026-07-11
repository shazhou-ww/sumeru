#!/usr/bin/env node
import type { CliContext } from "@ocas/cli-kit";
import { createCLI } from "@ocas/cli-kit";
import { z } from "zod";
import { ApiClientError, createApiClient } from "./api-client.js";
import { parseEnvFlagsFromArgv } from "./env-flags.js";
import { formatTable } from "./format-table.js";
import { createHostClient, HostClientError } from "./http-client.js";
import { getClient, resolveBaseUrl } from "./lazy.js";
import { runSessionModelCommand } from "./model-cmd.js";
import {
	isProcessAlive,
	readPidFile,
	removePidFile,
	resolvePidFilePath,
} from "./pid-file.js";
import { registerPrototypeRmCommand } from "./prototype-cmd.js";
import { registerSessionRmCommand } from "./session-cmd.js";

// ─── Shared schemas ─────────────────────────────────────────────────────

const messageSchema = z.object({ message: z.string() });
const nameSchema = z.object({ name: z.string() });
const idSchema = z.object({ id: z.string() });
const listSchema = z.array(z.record(z.string(), z.unknown()));
const statusSchema = z.object({
	name: z.string(),
	version: z.string(),
	running: z.number(),
	queued: z.number(),
	idle: z.number(),
	uptime: z.number(),
});

// ─── Helpers ─────────────────────────────────────────────────────────────

function handleClientError(err: unknown, ctx: CliContext): never {
	if (err instanceof HostClientError) {
		ctx.error(`${err.code}: ${err.message}`);
	}
	const msg = err instanceof Error ? err.message : String(err);
	if (msg === "fetch failed" || msg.includes("ECONNREFUSED")) {
		ctx.error("Could not connect to server");
	}
	ctx.error(msg);
}

function parseModelId(id: string): { provider: string; name: string } {
	const idx = id.indexOf(":");
	if (idx === -1) {
		throw new Error(
			`Invalid model ID "${id}". Expected format: provider:name (e.g., copilot:claude-sonnet-4)`,
		);
	}
	const provider = id.slice(0, idx);
	const name = id.slice(idx + 1);
	if (provider.length === 0 || name.length === 0) {
		throw new Error(
			`Invalid model ID "${id}". Expected format: provider:name (e.g., copilot:claude-sonnet-4)`,
		);
	}
	return { provider, name };
}

// ─── CLI definition ──────────────────────────────────────────────────────

const cli = createCLI({ name: "sumeru", version: "0.3.2" });

// ─── Group descriptions (shown in top-level --help) ─────────────────────

cli.command("server").describe("Manage the server process");
cli.command("adapter").describe("Query adapter registry");
cli.command("provider").describe("Manage LLM providers");
cli.command("model").describe("Manage LLM models");
cli.command("prototype").describe("Manage agent prototypes");
cli.command("session").describe("Manage agent sessions");

// ─── server ──────────────────────────────────────────────────────────────

cli
	.command("server")
	.command("start")
	.describe("Start the server process in the background")
	.returns(messageSchema, "{{message}}", { defaultFormat: "text" })
	.action(async (_args, _flags, ctx) => {
		try {
			await getClient();
			return { message: `Server running at ${resolveBaseUrl()}` };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			ctx.error(msg);
		}
	});

cli
	.command("server")
	.command("stop")
	.describe("Stop the running server")
	.returns(messageSchema, "{{message}}", { defaultFormat: "text" })
	.action(async (_args, _flags, ctx) => {
		const pidFilePath = resolvePidFilePath();
		const pid = readPidFile(pidFilePath);
		if (pid === null) {
			return { message: "Server is not running." };
		}
		if (!isProcessAlive(pid)) {
			removePidFile(pidFilePath);
			return { message: "Server is not running." };
		}
		try {
			process.kill(pid, "SIGTERM");
			return { message: "Server stopped." };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			ctx.error(`Failed to stop pid ${String(pid)}: ${msg}`);
		}
	});

cli
	.command("server")
	.command("restart")
	.describe("Restart the server process")
	.returns(messageSchema, "{{message}}", { defaultFormat: "text" })
	.action(async (_args, _flags, _ctx) => {
		const pidFilePath = resolvePidFilePath();
		const pid = readPidFile(pidFilePath);
		if (pid !== null && isProcessAlive(pid)) {
			try {
				process.kill(pid, "SIGTERM");
			} catch {}
			removePidFile(pidFilePath);
			// Wait for process to exit
			const deadline = Date.now() + 5000;
			while (Date.now() < deadline && isProcessAlive(pid)) {
				await new Promise((r) => setTimeout(r, 200));
			}
		}
		// Lazy start will spawn a new host
		await getClient();
		return { message: "Server restarted." };
	});

cli
	.command("server")
	.command("status")
	.describe("Show server status")
	.returns(statusSchema, "", { defaultFormat: "text" })
	.action(async (_args, _flags, ctx) => {
		const client = createHostClient({ baseUrl: resolveBaseUrl() });
		try {
			const envelope = await client.getRoot();
			const v = envelope.value;
			const url = new URL(resolveBaseUrl());
			const secs = v.uptime;
			const h = Math.floor(secs / 3600);
			const m = Math.floor((secs % 3600) / 60);
			const uptimeStr = h > 0 ? `${h}h ${m}m` : `${m}m`;
			ctx.stdout(
				`${[
					`Status: running`,
					`Port: ${url.port || "7900"}`,
					`Version: ${v.version}`,
					`Sessions: running=${v.status.running} queued=${v.status.queued} idle=${v.status.idle}`,
					`Uptime: ${uptimeStr}`,
				].join("\n")}\n`,
			);
			return undefined;
		} catch {
			ctx.stdout("Status: stopped\n");
			return undefined;
		}
	});

// ─── adapter ─────────────────────────────────────────────────────────────

cli
	.command("adapter")
	.command("list")
	.describe("List registered adapters")
	.returns(listSchema, {
		text: (value) =>
			formatTable(value as Array<Record<string, unknown>>, [
				"name",
				"providerMode",
				"credentialEnv",
			]),
	})
	.action(async (_args, _flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.listAdapters();
			return envelope.value;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("adapter")
	.command("get")
	.describe("Get an adapter by name")
	.arg("name", "Adapter name")
	.returns(
		z.object({
			name: z.string(),
			providerMode: z.string(),
			credentialEnv: z.string().nullable(),
		}),
		"{{name}} ({{providerMode}})",
		{ defaultFormat: "text" },
	)
	.action(async (args, _flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.getAdapter(args.name);
			const v = envelope.value;
			const line = v.credentialEnv
				? `${v.name} (${v.providerMode}) credential=${v.credentialEnv}`
				: `${v.name} (${v.providerMode})`;
			ctx.stdout(`${line}\n`);
			return undefined;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("adapter")
	.command("models")
	.describe("List built-in models for an adapter")
	.arg("name", "Adapter name")
	.returns(listSchema, {
		text: (value) =>
			formatTable(value as Array<Record<string, unknown>>, [
				"id",
				"name",
				"contextWindow",
			]),
	})
	.action(async (args, _flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.listAdapterModels(args.name);
			return envelope.value;
		} catch (err) {
			if (
				err instanceof HostClientError &&
				err.code === "models_not_supported"
			) {
				ctx.stdout(
					`Adapter ${args.name} has no built-in models.\nUse 'sumeru provider' and 'sumeru model' to configure a shared model registry.\n`,
				);
				return undefined;
			}
			handleClientError(err, ctx);
		}
	});

// ─── provider ────────────────────────────────────────────────────────────

cli
	.command("provider")
	.command("list")
	.describe("List registered providers")
	.returns(listSchema, {
		text: (value) =>
			formatTable(value as Array<Record<string, unknown>>, [
				"name",
				"apiType",
				"baseUrl",
			]),
	})
	.action(async (_args, _flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.listProviders();
			return envelope.value;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("provider")
	.command("get")
	.describe("Get a provider by name")
	.arg("name", "Provider name")
	.returns(
		z.object({
			name: z.string(),
			apiType: z.string(),
			baseUrl: z.string().nullable(),
		}),
		"{{name}} ({{apiType}}) {{baseUrl}}",
		{ defaultFormat: "text" },
	)
	.action(async (args, _flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.getProvider(args.name);
			const v = envelope.value;
			return { name: v.name, apiType: v.apiType, baseUrl: v.baseUrl };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("provider")
	.command("add")
	.describe("Register a new provider")
	.arg("name", "Provider name")
	.flag("api-type", {
		type: "string",
		description: "API type (openai or anthropic)",
	})
	.flag("base-url", { type: "string", description: "Provider base URL" })
	.flag("api-key", { type: "string", description: "API key" })
	.returns(nameSchema, "Created provider {{name}}", { defaultFormat: "text" })
	.action(async (args, flags, ctx) => {
		const apiType = flags["api-type"] as string | undefined;
		const baseUrl = (flags["base-url"] as string) ?? null;
		const apiKey = (flags["api-key"] as string) ?? null;
		if (!apiType || !baseUrl) {
			ctx.error(
				"Usage: sumeru provider add <name> --api-type <type> --base-url <url> [--api-key <key>]",
			);
		}
		if (apiType !== "anthropic" && apiType !== "openai") {
			ctx.error('Flag --api-type must be "anthropic" or "openai"');
		}
		const client = await getClient();
		try {
			const envelope = await client.addProvider(args.name, {
				apiType: apiType as "anthropic" | "openai",
				// biome-ignore lint/style/noNonNullAssertion: guarded by ctx.error above
				baseUrl: baseUrl!,
				apiKey,
			});
			return { name: envelope.value.name };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("provider")
	.command("update")
	.describe("Update a provider")
	.arg("name", "Provider name")
	.flag("api-type", {
		type: "string",
		description: "API type (openai or anthropic)",
	})
	.flag("base-url", { type: "string", description: "Provider base URL" })
	.flag("api-key", { type: "string", description: "API key" })
	.returns(nameSchema, "Updated provider {{name}}", { defaultFormat: "text" })
	.action(async (args, flags, ctx) => {
		const body: Record<string, unknown> = {};
		if (flags["api-type"] !== undefined) body.apiType = flags["api-type"];
		if (flags["base-url"] !== undefined) body.baseUrl = flags["base-url"];
		if (flags["api-key"] !== undefined) body.apiKey = flags["api-key"];
		const client = await getClient();
		try {
			const envelope = await client.updateProvider(
				args.name,
				body as Parameters<typeof client.updateProvider>[1],
			);
			return { name: envelope.value.name };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("provider")
	.command("remove")
	.describe("Remove a provider")
	.arg("name", "Provider name")
	.returns(messageSchema, "{{message}}", { defaultFormat: "text" })
	.action(async (args, _flags, ctx) => {
		const client = await getClient();
		try {
			await client.removeProvider(args.name);
			return { message: `Removed provider ${args.name}` };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

// ─── model ───────────────────────────────────────────────────────────────

cli
	.command("model")
	.command("list")
	.describe("List registered models")
	.flag("provider", { type: "string", description: "Filter by provider" })
	.returns(listSchema, {
		text: (value) =>
			formatTable(value as Array<Record<string, unknown>>, [
				"id",
				"provider",
				"model",
				"contextWindow",
			]),
	})
	.action(async (_args, flags, ctx) => {
		const client = await getClient();
		try {
			const provider = flags.provider as string | undefined;
			const envelope = await client.listModels(provider);
			const rows = envelope.value.map((m) => ({
				id: `${m.provider}:${m.name}`,
				provider: m.provider,
				model: m.model,
				contextWindow: m.contextWindow,
			}));
			return rows;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("model")
	.command("get")
	.describe("Get a model by provider:name")
	.arg("id", "Model ID (provider:name)")
	.returns(
		z.object({ name: z.string(), provider: z.string(), model: z.string() }),
		"",
		{ defaultFormat: "text" },
	)
	.action(async (args, _flags, ctx) => {
		const client = await getClient();
		try {
			const { provider, name } = parseModelId(args.id);
			const envelope = await client.getModel(provider, name);
			const v = envelope.value;
			ctx.stdout(`${v.provider}:${v.name} → ${v.model}\n`);
			return undefined;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("model")
	.command("add")
	.describe("Register a new model")
	.arg("id", "Model ID (provider:name)")
	.flag("model", { type: "string", description: "API model name" })
	.flag("context-window", {
		type: "number",
		description: "Context window size",
	})
	.flag("no-tool-use", { type: "boolean", description: "Disable tool use" })
	.flag("no-streaming", { type: "boolean", description: "Disable streaming" })
	.returns(idSchema, "Created model {{id}}", { defaultFormat: "text" })
	.action(async (args, flags, ctx) => {
		const apiModel = flags.model as string | undefined;
		if (!apiModel) {
			ctx.error(
				"Usage: sumeru model add <provider:name> --model <api-model> [--context-window N] [--no-tool-use] [--no-streaming]",
			);
		}
		const contextWindow =
			flags["context-window"] !== undefined
				? Number(flags["context-window"])
				: null;
		const client = await getClient();
		try {
			const { provider, name } = parseModelId(args.id);
			const envelope = await client.upsertModel(provider, name, {
				// biome-ignore lint/style/noNonNullAssertion: guarded by ctx.error above
				model: apiModel!,
				contextWindow,
				toolUse: !flags["no-tool-use"],
				streaming: !flags["no-streaming"],
				metadata: null,
			});
			return { id: `${envelope.value.provider}:${envelope.value.name}` };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("model")
	.command("update")
	.describe("Update a model")
	.arg("id", "Model ID (provider:name)")
	.flag("model", { type: "string", description: "API model name" })
	.flag("context-window", {
		type: "number",
		description: "Context window size",
	})
	.flag("no-tool-use", { type: "boolean", description: "Disable tool use" })
	.flag("no-streaming", { type: "boolean", description: "Disable streaming" })
	.returns(idSchema, "Updated model {{id}}", { defaultFormat: "text" })
	.action(async (args, flags, ctx) => {
		const body: Record<string, unknown> = {};
		if (flags.model !== undefined) body.model = flags.model;
		if (flags["context-window"] !== undefined)
			body.contextWindow = Number(flags["context-window"]);
		if (flags["no-tool-use"] !== undefined)
			body.toolUse = !flags["no-tool-use"];
		if (flags["no-streaming"] !== undefined)
			body.streaming = !flags["no-streaming"];
		const client = await getClient();
		try {
			const { provider, name } = parseModelId(args.id);
			const envelope = await client.upsertModel(
				provider,
				name,
				body as Parameters<typeof client.upsertModel>[2],
			);
			return { id: `${envelope.value.provider}:${envelope.value.name}` };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("model")
	.command("remove")
	.describe("Remove a model")
	.arg("id", "Model ID (provider:name)")
	.returns(messageSchema, "{{message}}", { defaultFormat: "text" })
	.action(async (args, _flags, ctx) => {
		const client = await getClient();
		try {
			const { provider, name } = parseModelId(args.id);
			await client.removeModel(provider, name);
			return { message: `Removed model ${args.id}` };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

// ─── prototype ───────────────────────────────────────────────────────────

cli
	.command("prototype")
	.command("list")
	.describe("List prototypes")
	.returns(listSchema, {
		text: (value) =>
			formatTable(value as Array<Record<string, unknown>>, [
				"name",
				"adapter",
				"model",
				"persona",
			]),
	})
	.action(async (_args, _flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.listPrototypes();
			return envelope.value;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("prototype")
	.command("get")
	.describe("Get a prototype by name")
	.arg("name", "Prototype name")
	.returns(
		z.object({
			name: z.string(),
			persona: z.string(),
			model: z.string().nullable(),
			adapter: z.string(),
		}),
		"{{name}} persona={{persona}} model={{model}} adapter={{adapter}}",
		{ defaultFormat: "text" },
	)
	.action(async (args, _flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.getPrototype(args.name);
			const p = envelope.value;
			return {
				name: p.name,
				persona: p.persona,
				model: p.model,
				adapter: p.adapter,
			};
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("prototype")
	.command("add")
	.describe("Register a new prototype")
	.arg("name", "Prototype name")
	.flag("model", { type: "string", description: "Model ID (provider:name)" })
	.flag("adapter", { type: "string", description: "Adapter name" })
	.flag("persona", {
		type: "string",
		default: "default",
		description: "Persona name",
	})
	.returns(nameSchema, "Created prototype {{name}}", { defaultFormat: "text" })
	.action(async (args, flags, ctx) => {
		const model = flags.model as string | undefined;
		const adapter = flags.adapter as string | undefined;
		const persona = (flags.persona as string) ?? "default";
		if (!model || !adapter) {
			ctx.error(
				"Usage: sumeru prototype add <name> --model <model-id> --adapter <adapter-name> [--persona <name>]",
			);
		}
		const client = await getClient();
		try {
			const envelope = await client.addPrototype(args.name, {
				persona,
				// biome-ignore lint/style/noNonNullAssertion: guarded by ctx.error above
				model: model!,
				// biome-ignore lint/style/noNonNullAssertion: guarded by ctx.error above
				adapter: adapter!,
			});
			return { name: envelope.value.name };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("prototype")
	.command("update")
	.describe("Update a prototype")
	.arg("name", "Prototype name")
	.flag("model", { type: "string", description: "Model ID (provider:name)" })
	.flag("adapter", { type: "string", description: "Adapter name" })
	.flag("persona", { type: "string", description: "Persona name" })
	.returns(nameSchema, "Updated prototype {{name}}", { defaultFormat: "text" })
	.action(async (args, flags, ctx) => {
		const body: Record<string, unknown> = {};
		if (flags.model !== undefined) body.model = flags.model;
		if (flags.adapter !== undefined) body.adapter = flags.adapter;
		if (flags.persona !== undefined) body.persona = flags.persona;
		const client = await getClient();
		try {
			const envelope = await client.updatePrototype(
				args.name,
				body as Parameters<typeof client.updatePrototype>[1],
			);
			return { name: envelope.value.name };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("prototype")
	.command("remove")
	.describe("Remove a prototype")
	.arg("name", "Prototype name")
	.returns(messageSchema, "{{message}}", { defaultFormat: "text" })
	.action(async (args, _flags, ctx) => {
		const client = await getClient();
		try {
			await client.removePrototype(args.name);
			return { message: `Removed prototype ${args.name}` };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

// ─── persona ─────────────────────────────────────────────────────────────

cli.command("persona").describe("Manage personas (system prompts)");

cli
	.command("persona")
	.command("list")
	.describe("List personas")
	.returns(listSchema, {
		text: (value) => {
			const rows = value as Array<Record<string, unknown>>;
			if (rows.length === 0) return "(empty)\n";
			return rows
				.map((p) => `[${p.name}]\n${p.instructions ?? ""}\n`)
				.join("\n");
		},
	})
	.action(async (_args, _flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.listPersonas();
			return envelope.value;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("persona")
	.command("get")
	.describe("Get persona details")
	.arg("name", "Persona name")
	.returns(
		z.object({ name: z.string(), instructions: z.string() }),
		"{{name}}: {{instructions}}",
		{ defaultFormat: "text" },
	)
	.action(async (args, _flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.getPersona(args.name);
			return envelope.value;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("persona")
	.command("add")
	.describe("Create a persona")
	.arg("name", "Persona name")
	.flag("instructions", { type: "string", description: "System prompt text" })
	.returns(nameSchema, "Created persona {{name}}", { defaultFormat: "text" })
	.action(async (args, flags, ctx) => {
		const instructions = flags.instructions as string | undefined;
		if (!instructions) {
			ctx.error("--instructions is required");
		}
		const client = await getClient();
		try {
			const envelope = await client.addPersona(args.name, {
				// biome-ignore lint/style/noNonNullAssertion: guarded by ctx.error above
				instructions: instructions!,
			});
			return { name: envelope.value.name };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("persona")
	.command("remove")
	.describe("Delete a persona")
	.arg("name", "Persona name")
	.returns(messageSchema, "{{message}}", { defaultFormat: "text" })
	.action(async (args, _flags, ctx) => {
		const client = await getClient();
		try {
			await client.removePersona(args.name);
			return { message: `Removed persona ${args.name}` };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

// ─── session ─────────────────────────────────────────────────────────────

cli
	.command("session")
	.command("list")
	.describe("List sessions")
	.returns(listSchema, {
		text: (value) =>
			formatTable(
				(value as Array<Record<string, unknown>>).map((s) => ({
					...s,
					task:
						typeof s.task === "string" && s.task.length > 50
							? `${s.task.slice(0, 47)}...`
							: s.task,
				})),
				["id", "prototype", "status", "task"],
			),
	})
	.action(async (_args, _flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.listSessions();
			return envelope.value;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("session")
	.command("get")
	.describe("Get session details")
	.arg("id", "Session ID")
	.returns(
		z.object({ id: z.string(), prototype: z.string(), status: z.string() }),
		"{{id}} {{prototype}} [{{status}}]",
		{ defaultFormat: "text" },
	)
	.action(async (args, _flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.getSession(args.id);
			const v = envelope.value;
			return { id: v.id, prototype: v.prototype, status: v.status };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("session")
	.command("add")
	.describe("Create a new session")
	.arg("prototype", "Prototype to use")
	.flag("project", { type: "string", description: "Project directory path" })
	.flag("task", { type: "string", description: "Initial task message" })
	.flag("env", {
		type: "string",
		description: "Environment variables (KEY=VALUE)",
	})
	.returns(idSchema, "Created session {{id}}", { defaultFormat: "text" })
	.action(async (args, flags, ctx) => {
		const project = (flags.project as string | undefined) ?? null;
		const task = (flags.task as string | undefined) ?? null;
		let env: Record<string, string> | null = null;
		try {
			env = parseEnvFlagsFromArgv(process.argv.slice(2));
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			ctx.error(msg);
		}
		const client = await getClient();
		try {
			const envelope = await client.addSession({
				prototype: args.prototype,
				project,
				task,
				model: null,
				env,
			});
			return { id: envelope.value.id };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("session")
	.command("stop")
	.describe("Stop a running session")
	.arg("id", "Session ID")
	.returns(messageSchema, "{{message}}", { defaultFormat: "text" })
	.action(async (args, _flags, ctx) => {
		const client = await getClient();
		try {
			await client.stopSession(args.id);
			return { message: `stopped ${args.id}` };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("session")
	.command("remove")
	.describe("Delete a session")
	.arg("id", "Session ID")
	.returns(messageSchema, "{{message}}", { defaultFormat: "text" })
	.action(async (args, _flags, ctx) => {
		const client = await getClient();
		try {
			await client.removeSession(args.id);
			return { message: `Removed session ${args.id}` };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("session")
	.command("send")
	.describe("Send a message to a session")
	.arg("id", "Session ID")
	.arg("message", "Message text")
	.flag("model", {
		type: "string",
		description: "Override model for this message",
	})
	.flag("env", {
		type: "string",
		description: "Environment variables (KEY=VALUE)",
	})
	.returns(messageSchema, "{{message}}", { defaultFormat: "text" })
	.action(async (args, flags, ctx) => {
		let env: Record<string, string> | null = null;
		try {
			env = parseEnvFlagsFromArgv(process.argv.slice(2));
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			ctx.error(msg);
		}
		const model = (flags.model as string | undefined) ?? null;
		const client = await getClient();
		try {
			const envelope = await client.submitMessage(args.id, {
				content: args.message,
				env,
				model,
			});
			return {
				message: `accepted message ${envelope.value.messageId} for ${envelope.value.sessionId}`,
			};
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("session")
	.command("logs")
	.describe("Stream session events")
	.arg("id", "Session ID")
	.flag("follow", {
		type: "boolean",
		alias: "f",
		description: "Follow (stream) events",
	})
	.returns(messageSchema, "{{message}}", { defaultFormat: "text" })
	.action(async (args, flags, ctx) => {
		const follow = Boolean(flags.follow);
		const client = await getClient();

		let gotExit = false;
		const printEvent = (event: string, data: string): void => {
			if (event === "heartbeat") return;
			ctx.stdout(`event: ${event}\n`);
			ctx.stdout(`data: ${data}\n\n`);
			if (event === "exit") {
				gotExit = true;
			}
		};

		try {
			do {
				gotExit = false;
				await client.streamEvents(args.id, printEvent);
				if (gotExit || !follow) break;
			} while (follow);
			return undefined;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("session")
	.command("turns")
	.describe("List turns for a session")
	.arg("id", "Session ID")
	.flag("after", { type: "number", description: "Show turns after this ID" })
	.flag("system", { type: "boolean", description: "Include system prompt" })
	.returns(listSchema, {
		text: (value) => {
			const turns = value as Array<Record<string, unknown>>;
			if (turns.length === 0) return "(empty)\n";
			return turns
				.map((turn) => {
					const role = turn.role;
					const ts = turn.timestamp ?? "";
					const content =
						role === "assistant" || role === "user"
							? turn.content
							: role === "tool"
								? turn.result
								: "";
					return `[${role}] ${ts}\n${content}\n`;
				})
				.join("\n");
		},
	})
	.action(async (args, flags, ctx) => {
		const after = flags.after !== undefined ? Number(flags.after) : undefined;
		const system = Boolean(flags.system);
		const client = await getClient();
		try {
			const envelope = await client.getTurns(args.id, { after, system });
			return envelope.value;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

// ─── session exec ────────────────────────────────────────────────────────

cli
	.command("session")
	.command("exec")
	.describe("Run a shell command in a session container")
	.arg("id", "Session ID")
	.returns(messageSchema, "{{message}}", { defaultFormat: "text" })
	.action(async (args, _flags, ctx) => {
		const separator = process.argv.indexOf("--");
		if (separator === -1) {
			ctx.error("Usage: sumeru session exec <id> -- <command...>");
		}
		const parts = process.argv.slice(separator + 1);
		if (parts.length === 0) {
			ctx.error("Usage: sumeru session exec <id> -- <command...>");
		}
		const command = parts.join(" ");
		const api = createApiClient(resolveBaseUrl());
		try {
			const result = await api.postCommand(args.id, {
				type: "exec",
				command,
			});
			if (result.mode !== "sync" || result.value.type !== "exec") {
				ctx.error("Expected sync exec result");
			}
			const execResult = result.value as {
				type: "exec";
				stdout: string;
				stderr: string;
				exitCode: number;
			};
			process.stdout.write(execResult.stdout);
			if (execResult.stderr.length > 0) {
				process.stderr.write(execResult.stderr);
			}
			process.exit(execResult.exitCode);
		} catch (err) {
			if (err instanceof ApiClientError) {
				ctx.error(`${err.code}: ${err.message}`);
			}
			const msg = err instanceof Error ? err.message : String(err);
			ctx.error(msg);
		}
	});

// ─── session reset ───────────────────────────────────────────────────────

cli
	.command("session")
	.command("reset")
	.describe("Reset a session context, optionally with a new persona")
	.arg("id", "Session ID")
	.flag("persona", { type: "string", description: "New persona to apply" })
	.returns(messageSchema, "{{message}}", { defaultFormat: "text" })
	.action(async (args, flags, ctx) => {
		const persona = (flags.persona as string | undefined) ?? null;
		const api = createApiClient(resolveBaseUrl());
		try {
			await api.postCommand(args.id, { type: "reset", persona });
			return { message: `reset ${args.id}` };
		} catch (err) {
			if (err instanceof ApiClientError) {
				ctx.error(`${err.code}: ${err.message}`);
			}
			const msg = err instanceof Error ? err.message : String(err);
			ctx.error(msg);
		}
	});

// ─── session snapshot ────────────────────────────────────────────────────

cli
	.command("session")
	.command("snapshot")
	.describe("Snapshot a session into a new prototype image")
	.arg("id", "Session ID")
	.arg("name", "Snapshot name")
	.returns(messageSchema, "{{message}}", { defaultFormat: "text" })
	.action(async (args, _flags, ctx) => {
		const api = createApiClient(resolveBaseUrl());
		try {
			const result = await api.postCommand(args.id, {
				type: "snapshot",
				name: args.name,
			});
			if (result.mode !== "sync" || result.value.type !== "snapshot") {
				ctx.error("Expected sync snapshot result");
			}
			const snapshotResult = result.value as {
				type: "snapshot";
				name: string;
				image: string;
			};
			return { message: `${snapshotResult.name} ${snapshotResult.image}` };
		} catch (err) {
			if (err instanceof ApiClientError) {
				ctx.error(`${err.code}: ${err.message}`);
			}
			const msg = err instanceof Error ? err.message : String(err);
			ctx.error(msg);
		}
	});

// ─── search ──────────────────────────────────────────────────────────────

cli
	.command("search")
	.describe("Full-text search across sessions")
	.arg("query", "Search query")
	.flag("session", { type: "string" })
	.returns(
		z.object({ query: z.string(), hits: z.number() }),
		"{{query}} — {{hits}} hits",
		{ defaultFormat: "text" },
	)
	.action(async (args, flags, ctx) => {
		const sessionFilter = (flags.session as string | undefined) ?? undefined;
		const client = await getClient();
		try {
			const envelope = await client.search(args.query, {
				session: sessionFilter,
			});
			const v = envelope.value;
			for (const hit of v.hits) {
				ctx.stdout(`[${hit.sessionId}] ${hit.content.slice(0, 120)}\n`);
			}
			return { query: v.query, hits: v.hits.length };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

// ─── Phase 3: verb + target commands ────────────────────────────────────

registerSessionRmCommand(cli);
registerPrototypeRmCommand(cli);

// ─── Run ─────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

// Handle --version / -v before CLI dispatch
if (argv.includes("--version") || argv.includes("-v")) {
	process.stdout.write("sumeru 0.3.2\n");
	process.exit(0);
}

// Validate --format before CLI dispatch
const formatIdx = argv.indexOf("--format");
if (formatIdx !== -1) {
	const fmt = argv[formatIdx + 1];
	const supported = ["text", "json", "yaml"];
	if (!fmt || !supported.includes(fmt)) {
		process.stderr.write(
			`Error: Unsupported format '${fmt ?? ""}'. Available: ${supported.join(", ")}\n`,
		);
		process.exit(1);
	}
}

// Reject --json (use --format json instead)
if (argv.includes("--json")) {
	process.stderr.write(
		"Error: Unknown flag '--json'. Use '--format json' instead.\n",
	);
	process.exit(1);
}

const modelExitCode = await runSessionModelCommand(argv);
if (modelExitCode !== null) {
	process.exit(modelExitCode);
}

const exitCode = await cli.run();
process.exit(exitCode);
