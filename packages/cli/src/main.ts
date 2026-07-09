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
		ctx.error("Could not connect to host");
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

cli.command("server").describe("Manage the host process");
cli.command("adapter").describe("Query adapter registry");
cli.command("provider").describe("Manage LLM providers");
cli.command("model").describe("Manage LLM models");
cli.command("prototype").describe("Manage agent prototypes");
cli.command("extension").describe("Manage Docker extensions");
cli.command("persona").describe("Manage agent personas");
cli.command("skill").describe("Manage skills");
cli.command("session").describe("Manage agent sessions");

// ─── server ──────────────────────────────────────────────────────────────

cli
	.command("server")
	.command("start")
	.describe("Start the host process in the background")
	.returns(messageSchema, "{{message}}")
	.action(async (_args, _flags, ctx) => {
		try {
			await getClient();
			return { message: `Host running at ${resolveBaseUrl()}` };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			ctx.error(msg);
		}
	});

cli
	.command("server")
	.command("stop")
	.describe("Stop the running host")
	.returns(messageSchema, "{{message}}")
	.action(async (_args, _flags, ctx) => {
		const pidFilePath = resolvePidFilePath();
		const pid = readPidFile(pidFilePath);
		if (pid === null) {
			return {
				message:
					`No PID file at ${pidFilePath}.\n` +
					`If the host is running, stop it with: kill $(cat ${pidFilePath})`,
			};
		}
		if (!isProcessAlive(pid)) {
			removePidFile(pidFilePath);
			return {
				message: `Removed stale PID file (pid ${String(pid)} not running).`,
			};
		}
		try {
			process.kill(pid, "SIGTERM");
			return { message: `Sent SIGTERM to host pid ${String(pid)}.` };
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			ctx.error(`Failed to stop pid ${String(pid)}: ${msg}`);
		}
	});

cli
	.command("server")
	.command("restart")
	.describe("Restart the host process")
	.returns(messageSchema, "{{message}}")
	.action(async (_args, _flags, ctx) => {
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
		return { message: "Host restarted." };
	});

cli
	.command("server")
	.command("status")
	.describe("Show host status")
	.returns(
		statusSchema,
		"{{name}} {{version}} running={{running}} queued={{queued}} idle={{idle}}",
	)
	.action(async (_args, _flags, ctx) => {
		const client = createHostClient({ baseUrl: resolveBaseUrl() });
		try {
			const envelope = await client.getRoot();
			const v = envelope.value;
			return {
				name: v.name,
				version: v.version,
				running: v.status.running,
				queued: v.status.queued,
				idle: v.status.idle,
				uptime: v.uptime,
			};
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

// ─── adapter ─────────────────────────────────────────────────────────────

cli
	.command("adapter")
	.command("list")
	.describe("List registered adapters")
	.returns(listSchema, "")
	.action(async (_args, flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.listAdapters();
			ctx.stdout(
				formatTable(envelope.value as Array<Record<string, unknown>>, [
					"name",
					"providerMode",
					"credentialEnv",
				]),
			);
			return undefined;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("adapter")
	.command("get")
	.describe("Get an adapter by name")
	.arg("name")
	.returns(
		z.object({
			name: z.string(),
			providerMode: z.string(),
			credentialEnv: z.string().nullable(),
		}),
		"{{name}} ({{providerMode}}) credential={{credentialEnv}}",
	)
	.action(async (args, flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.getAdapter(args.name);
			const v = envelope.value;
			return {
				name: v.name,
				providerMode: v.providerMode,
				credentialEnv: v.credentialEnv,
			};
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("adapter")
	.command("models")
	.describe("List built-in models for an adapter")
	.arg("name")
	.returns(listSchema, "")
	.action(async (args, flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.listAdapterModels(args.name);
			ctx.stdout(
				formatTable(envelope.value as Array<Record<string, unknown>>, [
					"id",
					"name",
					"contextWindow",
				]),
			);
			return undefined;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

// ─── provider ────────────────────────────────────────────────────────────

cli
	.command("provider")
	.command("list")
	.describe("List registered providers")
	.returns(listSchema, "")
	.action(async (_args, flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.listProviders();
			ctx.stdout(
				formatTable(envelope.value as Array<Record<string, unknown>>, [
					"name",
					"apiType",
					"baseUrl",
				]),
			);
			return undefined;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("provider")
	.command("get")
	.describe("Get a provider by name")
	.arg("name")
	.returns(
		z.object({
			name: z.string(),
			apiType: z.string(),
			baseUrl: z.string().nullable(),
		}),
		"{{name}} ({{apiType}}) {{baseUrl}}",
	)
	.action(async (args, flags, ctx) => {
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
	.arg("name")
	.flag("api-type", { type: "string" })
	.flag("base-url", { type: "string" })
	.flag("api-key", { type: "string" })
	.returns(nameSchema, "{{name}}")
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
	.arg("name")
	.flag("api-type", { type: "string" })
	.flag("base-url", { type: "string" })
	.flag("api-key", { type: "string" })
	.returns(nameSchema, "{{name}}")
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
	.arg("name")
	.returns(messageSchema, "{{message}}")
	.action(async (args, flags, ctx) => {
		const client = await getClient();
		try {
			await client.removeProvider(args.name);
			return { message: `removed provider ${args.name}` };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

// ─── model ───────────────────────────────────────────────────────────────

cli
	.command("model")
	.command("list")
	.describe("List registered models")
	.flag("provider", { type: "string" })
	.returns(listSchema, "")
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
			ctx.stdout(
				formatTable(rows, ["id", "provider", "model", "contextWindow"]),
			);
			return undefined;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("model")
	.command("get")
	.describe("Get a model by provider:name")
	.arg("id")
	.returns(
		z.object({ name: z.string(), provider: z.string(), model: z.string() }),
		"{{provider}}:{{name}} {{model}}",
	)
	.action(async (args, flags, ctx) => {
		const client = await getClient();
		try {
			const { provider, name } = parseModelId(args.id);
			const envelope = await client.getModel(provider, name);
			const v = envelope.value;
			return { name: v.name, provider: v.provider, model: v.model };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("model")
	.command("add")
	.describe("Register a new model")
	.arg("id")
	.flag("model", { type: "string" })
	.flag("context-window", { type: "number" })
	.flag("no-tool-use", { type: "boolean" })
	.flag("no-streaming", { type: "boolean" })
	.returns(idSchema, "{{id}}")
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
	.arg("id")
	.flag("model", { type: "string" })
	.flag("context-window", { type: "number" })
	.flag("no-tool-use", { type: "boolean" })
	.flag("no-streaming", { type: "boolean" })
	.returns(idSchema, "{{id}}")
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
	.arg("id")
	.returns(messageSchema, "{{message}}")
	.action(async (args, flags, ctx) => {
		const client = await getClient();
		try {
			const { provider, name } = parseModelId(args.id);
			await client.removeModel(provider, name);
			return { message: `removed model ${args.id}` };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

// ─── prototype ───────────────────────────────────────────────────────────

cli
	.command("prototype")
	.command("list")
	.describe("List prototypes")
	.returns(listSchema, "")
	.action(async (_args, flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.listPrototypes();
			ctx.stdout(
				formatTable(envelope.value as Array<Record<string, unknown>>, [
					"name",
					"adapter",
					"model",
					"persona",
				]),
			);
			return undefined;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("prototype")
	.command("get")
	.describe("Get a prototype by name")
	.arg("name")
	.returns(
		z.object({
			name: z.string(),
			persona: z.string(),
			model: z.string().nullable(),
			adapter: z.string(),
		}),
		"{{name}} persona={{persona}} model={{model}} adapter={{adapter}}",
	)
	.action(async (args, flags, ctx) => {
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
	.arg("name")
	.flag("model", { type: "string" })
	.flag("adapter", { type: "string" })
	.flag("persona", { type: "string", default: "default" })
	.returns(nameSchema, "{{name}}")
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
				model: model!,
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
	.arg("name")
	.flag("model", { type: "string" })
	.flag("adapter", { type: "string" })
	.flag("persona", { type: "string" })
	.returns(nameSchema, "{{name}}")
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
	.arg("name")
	.returns(messageSchema, "{{message}}")
	.action(async (args, flags, ctx) => {
		const client = await getClient();
		try {
			await client.removePrototype(args.name);
			return { message: `removed prototype ${args.name}` };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

// ─── extension ───────────────────────────────────────────────────────────

cli
	.command("extension")
	.command("list")
	.describe("List extensions")
	.returns(listSchema, "")
	.action(async (_args, flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.listExtensions();
			ctx.stdout(
				formatTable(envelope.value as Array<Record<string, unknown>>, ["name"]),
			);
			return undefined;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("extension")
	.command("get")
	.describe("Get an extension by name")
	.arg("name")
	.returns(
		z.object({
			name: z.string(),
			description: z.string(),
			dockerfile: z.string(),
		}),
		"{{name}} — {{description}}",
	)
	.action(async (args, flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.getExtension(args.name);
			const v = envelope.value;
			return {
				name: v.name,
				description: v.description,
				dockerfile: v.dockerfile,
			};
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("extension")
	.command("put")
	.describe("Create or update an extension")
	.arg("name")
	.flag("description", { type: "string" })
	.flag("dockerfile", { type: "string" })
	.returns(nameSchema, "{{name}}")
	.action(async (args, flags, ctx) => {
		const dockerfile = flags.dockerfile as string | undefined;
		if (!dockerfile) {
			ctx.error(
				"Usage: sumeru extension put <name> --dockerfile <instructions> [--description <desc>]",
			);
		}
		const client = await getClient();
		try {
			const envelope = await client.upsertExtension(args.name, {
				description: (flags.description as string) ?? "",
				dockerfile: dockerfile!,
			});
			return { name: envelope.value.name };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("extension")
	.command("remove")
	.describe("Remove an extension")
	.arg("name")
	.returns(messageSchema, "{{message}}")
	.action(async (args, flags, ctx) => {
		const client = await getClient();
		try {
			await client.removeExtension(args.name);
			return { message: `removed extension ${args.name}` };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

// ─── persona ─────────────────────────────────────────────────────────────

cli
	.command("persona")
	.command("list")
	.describe("List personas")
	.returns(listSchema, "")
	.action(async (_args, flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.listPersonas();
			ctx.stdout(
				formatTable(envelope.value as Array<Record<string, unknown>>, ["name"]),
			);
			return undefined;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("persona")
	.command("get")
	.describe("Get a persona by name")
	.arg("name")
	.returns(
		z.object({ name: z.string(), skills: z.array(z.string()) }),
		"{{name}} skills=[{{skills}}]",
	)
	.action(async (args, flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.getPersona(args.name);
			const v = envelope.value;
			return { name: v.name, skills: v.skills };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("persona")
	.command("add")
	.describe("Register a new persona")
	.arg("name")
	.flag("instructions", { type: "string" })
	.flag("skills", { type: "string" })
	.returns(nameSchema, "{{name}}")
	.action(async (args, flags, ctx) => {
		const instructions = (flags.instructions as string) ?? "";
		const skillsRaw = (flags.skills as string) ?? "";
		const skills = skillsRaw.length > 0 ? skillsRaw.split(",") : [];
		const client = await getClient();
		try {
			const envelope = await client.addPersona(args.name, {
				instructions,
				skills,
			});
			return { name: envelope.value.name };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("persona")
	.command("update")
	.describe("Update a persona")
	.arg("name")
	.flag("instructions", { type: "string" })
	.flag("skills", { type: "string" })
	.returns(nameSchema, "{{name}}")
	.action(async (args, flags, ctx) => {
		const body: Record<string, unknown> = {};
		if (flags.instructions !== undefined)
			body.instructions = flags.instructions;
		if (flags.skills !== undefined)
			body.skills = (flags.skills as string).split(",");
		const client = await getClient();
		try {
			const envelope = await client.updatePersona(
				args.name,
				body as Parameters<typeof client.updatePersona>[1],
			);
			return { name: envelope.value.name };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("persona")
	.command("remove")
	.describe("Remove a persona")
	.arg("name")
	.returns(messageSchema, "{{message}}")
	.action(async (args, flags, ctx) => {
		const client = await getClient();
		try {
			await client.removePersona(args.name);
			return { message: `removed persona ${args.name}` };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

// ─── skill ───────────────────────────────────────────────────────────────

cli
	.command("skill")
	.command("get")
	.describe("Get a skill by name")
	.arg("name")
	.returns(
		z.object({ name: z.string(), content: z.string() }),
		"{{name}}\n{{content}}",
		{ defaultFormat: "text" },
	)
	.action(async (args, flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.getSkill(args.name);
			return envelope.value;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("skill")
	.command("put")
	.describe("Create or update a skill")
	.arg("name")
	.flag("content", { type: "string" })
	.returns(nameSchema, "{{name}}")
	.action(async (args, flags, ctx) => {
		const content = flags.content as string | undefined;
		if (!content) {
			ctx.error("Usage: sumeru skill put <name> --content <text>");
		}
		const client = await getClient();
		try {
			const envelope = await client.putSkill(args.name, content!);
			return { name: envelope.value.name };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("skill")
	.command("remove")
	.describe("Remove a skill")
	.arg("name")
	.returns(messageSchema, "{{message}}")
	.action(async (args, flags, ctx) => {
		const client = await getClient();
		try {
			await client.removeSkill(args.name);
			return { message: `removed skill ${args.name}` };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

// ─── session ─────────────────────────────────────────────────────────────

cli
	.command("session")
	.command("list")
	.describe("List sessions")
	.returns(listSchema, "")
	.action(async (_args, flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.listSessions();
			ctx.stdout(
				formatTable(
					(envelope.value as Array<Record<string, unknown>>).map((s) => ({
						...s,
						task:
							typeof s.task === "string" && s.task.length > 50
								? `${s.task.slice(0, 47)}...`
								: s.task,
					})),
					["id", "prototype", "status", "task"],
				),
			);
			return undefined;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("session")
	.command("get")
	.describe("Get session details")
	.arg("id")
	.returns(
		z.object({ id: z.string(), prototype: z.string(), status: z.string() }),
		"{{id}} {{prototype}} [{{status}}]",
	)
	.action(async (args, flags, ctx) => {
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
	.arg("prototype")
	.flag("project", { type: "string" })
	.flag("task", { type: "string" })
	.flag("env", { type: "string" })
	.returns(idSchema, "{{id}}")
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
	.arg("id")
	.returns(messageSchema, "{{message}}")
	.action(async (args, flags, ctx) => {
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
	.arg("id")
	.returns(messageSchema, "{{message}}")
	.action(async (args, flags, ctx) => {
		const client = await getClient();
		try {
			await client.removeSession(args.id);
			return { message: `deleted ${args.id}` };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("session")
	.command("send")
	.describe("Send a message to a session")
	.arg("id")
	.arg("message")
	.flag("model", { type: "string" })
	.flag("env", { type: "string" })
	.returns(messageSchema, "{{message}}")
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
	.arg("id")
	.flag("follow", { type: "boolean", alias: "f" })
	.returns(messageSchema, "{{message}}")
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
	.arg("id")
	.flag("after", { type: "number" })
	.returns(listSchema, "")
	.action(async (args, flags, ctx) => {
		const after = flags.after !== undefined ? Number(flags.after) : undefined;
		const client = await getClient();
		try {
			const envelope = await client.getTurns(args.id, { after });
			const rows = envelope.value.map((turn) => {
				const raw =
					turn.role === "assistant"
						? turn.content
						: turn.role === "tool"
							? turn.result
							: "";
				const flat = raw.replace(/[\n\r\t]+/g, " ").trim();
				const content = flat.length > 80 ? `${flat.slice(0, 77)}...` : flat;
				return { id: turn.id, role: turn.role, content };
			});
			ctx.stdout(formatTable(rows, ["id", "role", "content"]));
			return undefined;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

// ─── session exec ────────────────────────────────────────────────────────

cli
	.command("session")
	.command("exec")
	.describe("Run a shell command in a session container")
	.arg("id")
	.returns(messageSchema, "{{message}}", { defaultFormat: "text" })
	.action(async (args, flags, ctx) => {
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
	.arg("id")
	.flag("persona", { type: "string" })
	.returns(messageSchema, "{{message}}")
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
	.arg("id")
	.arg("name")
	.returns(messageSchema, "{{message}}")
	.action(async (args, flags, ctx) => {
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
	.arg("query")
	.flag("session", { type: "string" })
	.returns(
		z.object({ query: z.string(), hits: z.number() }),
		"{{query}} — {{hits}} hits",
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

const modelExitCode = await runSessionModelCommand(argv);
if (modelExitCode !== null) {
	process.exit(modelExitCode);
}

const exitCode = await cli.run();
process.exit(exitCode);
