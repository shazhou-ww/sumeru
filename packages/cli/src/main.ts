#!/usr/bin/env node
import type { CliContext } from "@ocas/cli-kit";
import { createCLI } from "@ocas/cli-kit";
import type { Turn } from "@sumeru/core";
import { z } from "zod";
import { ApiClientError, createApiClient } from "./api-client.js";
import { parseEnvFlagsFromArgv } from "./env-flags.js";
import {
	formatTableWithPagination,
	type PaginatedArray,
} from "./format-table.js";
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

const TURN_LOG_PREVIEW_MAX = 120;

function previewText(text: string, maxLen = TURN_LOG_PREVIEW_MAX): string {
	const oneLine = text.replace(/\s+/g, " ").trim();
	if (oneLine.length <= maxLen) return oneLine;
	return `${oneLine.slice(0, maxLen - 3)}...`;
}

function formatTurnLogLine(turn: Turn): string {
	if (turn.role === "tool") {
		return `[tool] ${turn.name}: ${previewText(turn.result)}`;
	}
	return `[${turn.role}] ${previewText(turn.content)}`;
}

function formatWatchTurnLine(turn: Turn): string {
	if (turn.role === "tool") {
		return `[tool] ${turn.name}: ${turn.result}`;
	}
	return `[${turn.role}] ${turn.content}`;
}

function isStreamCloseError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	if (msg === "terminated" || msg.includes("ECONNRESET")) return true;
	const cause = err instanceof Error ? err.cause : undefined;
	if (cause instanceof Error && cause.message.includes("ECONNRESET"))
		return true;
	return false;
}

function parseContextWindow(value: string): number {
	const s = value.trim().toLowerCase();
	const match = s.match(/^(\d+(?:\.\d+)?)\s*([km]?)$/);
	if (!match) return Number(value);
	// biome-ignore lint/style/noNonNullAssertion: regex groups guaranteed by match
	const num = Number.parseFloat(match[1]!);
	const suffix = match[2];
	if (suffix === "k") return Math.round(num * 1000);
	if (suffix === "m") return Math.round(num * 1000000);
	return Math.round(num);
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
	.flag("limit", { type: "number", description: "Max results (default 50)" })
	.flag("offset", { type: "number", description: "Skip first N results" })
	.returns(listSchema, {
		text: (value) =>
			formatTableWithPagination(value, [
				"name",
				"providerMode",
				"credentialEnv",
			]),
	})
	.action(async (_args, flags, ctx) => {
		const limit = (flags.limit as number | undefined) ?? 50;
		const offset = (flags.offset as number | undefined) ?? 0;
		const client = await getClient();
		try {
			const envelope = await client.listAdapters();
			const all = envelope.value;
			const page = all.slice(offset, offset + limit) as PaginatedArray<
				Record<string, unknown>
			>;
			page._total = all.length;
			page._offset = offset;
			return page;
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
		{
			text: (value) => {
				const v = value as Record<string, unknown>;
				return `${[
					`Name: ${v.name}`,
					`Mode: ${v.providerMode}`,
					v.credentialEnv ? `Credential: ${v.credentialEnv}` : null,
				]
					.filter(Boolean)
					.join("\n")}\n`;
			},
		},
		{ defaultFormat: "text" },
	)
	.action(async (args, _flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.getAdapter(args.name);
			return envelope.value;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("adapter")
	.command("models")
	.describe("List built-in models for an adapter")
	.arg("name", "Adapter name")
	.flag("limit", { type: "number", description: "Max results (default 50)" })
	.flag("offset", { type: "number", description: "Skip first N results" })
	.returns(listSchema, {
		text: (value) =>
			formatTableWithPagination(value, ["id", "name", "contextWindow"]),
	})
	.action(async (args, flags, ctx) => {
		const limit = (flags.limit as number | undefined) ?? 50;
		const offset = (flags.offset as number | undefined) ?? 0;
		const client = await getClient();
		try {
			const envelope = await client.listAdapterModels(args.name);
			const all = envelope.value;
			const page = all.slice(offset, offset + limit) as PaginatedArray<
				Record<string, unknown>
			>;
			page._total = all.length;
			page._offset = offset;
			return page;
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
	.flag("limit", { type: "number", description: "Max results (default 50)" })
	.flag("offset", { type: "number", description: "Skip first N results" })
	.returns(listSchema, {
		text: (value) =>
			formatTableWithPagination(value, ["name", "apiType", "baseUrl"]),
	})
	.action(async (_args, flags, ctx) => {
		const limit = (flags.limit as number | undefined) ?? 50;
		const offset = (flags.offset as number | undefined) ?? 0;
		const client = await getClient();
		try {
			const envelope = await client.listProviders();
			const all = envelope.value;
			const page = all.slice(offset, offset + limit) as PaginatedArray<
				Record<string, unknown>
			>;
			page._total = all.length;
			page._offset = offset;
			return page;
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
		{
			text: (value) => {
				const v = value as Record<string, unknown>;
				return `${[
					`Name: ${v.name}`,
					`Type: ${v.apiType}`,
					v.baseUrl ? `URL: ${v.baseUrl}` : null,
				]
					.filter(Boolean)
					.join("\n")}\n`;
			},
		},
		{ defaultFormat: "text" },
	)
	.action(async (args, _flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.getProvider(args.name);
			return envelope.value;
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

cli
	.command("provider")
	.command("models")
	.describe("List models available from a provider")
	.arg("name", "Provider name")
	.flag("limit", { type: "number", description: "Max results (default 50)" })
	.flag("offset", { type: "number", description: "Skip first N results" })
	.returns(listSchema, {
		text: (value) => formatTableWithPagination(value, ["id"]),
	})
	.action(async (args, flags, ctx) => {
		const limit = (flags.limit as number | undefined) ?? 50;
		const offset = (flags.offset as number | undefined) ?? 0;
		const client = await getClient();
		try {
			const envelope = await client.listProviderModels(args.name);
			const all = envelope.value;
			const page = all.slice(offset, offset + limit) as PaginatedArray<
				Record<string, unknown>
			>;
			page._total = all.length;
			page._offset = offset;
			return page;
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
	.flag("limit", { type: "number", description: "Max results (default 50)" })
	.flag("offset", { type: "number", description: "Skip first N results" })
	.returns(listSchema, {
		text: (value) =>
			formatTableWithPagination(value, [
				"name",
				"provider",
				"model",
				"contextWindow",
			]),
	})
	.action(async (_args, flags, ctx) => {
		const limit = (flags.limit as number | undefined) ?? 50;
		const offset = (flags.offset as number | undefined) ?? 0;
		const client = await getClient();
		try {
			const provider = flags.provider as string | undefined;
			const envelope = await client.listModels(provider);
			const all = envelope.value.map((m) => ({
				name: m.name,
				provider: m.provider,
				model: m.model,
				contextWindow: m.contextWindow,
			}));
			const page = all.slice(offset, offset + limit) as PaginatedArray<
				Record<string, unknown>
			>;
			page._total = all.length;
			page._offset = offset;
			return page;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("model")
	.command("get")
	.describe("Get a model by name")
	.arg("name", "Model registry name")
	.returns(
		z.object({
			name: z.string(),
			provider: z.string(),
			model: z.string(),
			contextWindow: z.number().nullable(),
		}),
		{
			text: (value) => {
				const v = value as Record<string, unknown>;
				return `${[
					`Name: ${v.name}`,
					`Provider: ${v.provider}`,
					`Model: ${v.model}`,
					v.contextWindow != null ? `Context: ${v.contextWindow}` : null,
				]
					.filter(Boolean)
					.join("\n")}\n`;
			},
		},
		{ defaultFormat: "text" },
	)
	.action(async (args, _flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.getModel(args.name);
			return envelope.value;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("model")
	.command("add")
	.describe("Register a new model")
	.arg("name", "Model registry name")
	.flag("provider", { type: "string", description: "Provider name" })
	.flag("model", { type: "string", description: "API model name" })
	.flag("context-window", {
		type: "string",
		description: "Context window size (e.g. 128k, 1m)",
	})
	.returns(nameSchema, "Created model {{name}}", { defaultFormat: "text" })
	.action(async (args, flags, ctx) => {
		const provider = flags.provider as string | undefined;
		const apiModel = flags.model as string | undefined;
		if (!provider || !apiModel) {
			ctx.error(
				"Usage: sumeru model add <name> --provider <provider> --model <api-model> [--context-window N]",
			);
		}
		const contextWindow =
			flags["context-window"] !== undefined
				? parseContextWindow(String(flags["context-window"]))
				: null;
		const client = await getClient();
		try {
			const envelope = await client.upsertModel(args.name, {
				// biome-ignore lint/style/noNonNullAssertion: guarded by ctx.error above
				provider: provider!,
				// biome-ignore lint/style/noNonNullAssertion: guarded by ctx.error above
				model: apiModel!,
				contextWindow,
				metadata: null,
			});
			return { name: envelope.value.name };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("model")
	.command("update")
	.describe("Update a model")
	.arg("name", "Model registry name")
	.flag("provider", { type: "string", description: "Provider name" })
	.flag("model", { type: "string", description: "API model name" })
	.flag("context-window", {
		type: "string",
		description: "Context window size (e.g. 128k, 1m)",
	})
	.returns(nameSchema, "Updated model {{name}}", { defaultFormat: "text" })
	.action(async (args, flags, ctx) => {
		const body: Record<string, unknown> = {};
		if (flags.provider !== undefined) body.provider = flags.provider;
		if (flags.model !== undefined) body.model = flags.model;
		if (flags["context-window"] !== undefined)
			body.contextWindow = parseContextWindow(String(flags["context-window"]));
		const client = await getClient();
		try {
			const envelope = await client.upsertModel(
				args.name,
				body as Parameters<typeof client.upsertModel>[1],
			);
			return { name: envelope.value.name };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("model")
	.command("remove")
	.describe("Remove a model")
	.arg("name", "Model registry name")
	.returns(messageSchema, "{{message}}", { defaultFormat: "text" })
	.action(async (args, _flags, ctx) => {
		const client = await getClient();
		try {
			await client.removeModel(args.name);
			return { message: `Removed model ${args.name}` };
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

// ─── prototype ───────────────────────────────────────────────────────────

cli
	.command("prototype")
	.command("list")
	.describe("List prototypes")
	.flag("limit", { type: "number", description: "Max results (default 50)" })
	.flag("offset", { type: "number", description: "Skip first N results" })
	.returns(listSchema, {
		text: (value) =>
			formatTableWithPagination(value, ["name", "adapter", "model", "persona"]),
	})
	.action(async (_args, flags, ctx) => {
		const limit = (flags.limit as number | undefined) ?? 50;
		const offset = (flags.offset as number | undefined) ?? 0;
		const client = await getClient();
		try {
			const envelope = await client.listPrototypes();
			const all = envelope.value;
			const page = all.slice(offset, offset + limit) as PaginatedArray<
				Record<string, unknown>
			>;
			page._total = all.length;
			page._offset = offset;
			return page;
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
		{
			text: (value) => {
				const v = value as Record<string, unknown>;
				return `${[
					`Name: ${v.name}`,
					`Adapter: ${v.adapter}`,
					v.model ? `Model: ${v.model}` : null,
					`Persona: ${v.persona}`,
				]
					.filter(Boolean)
					.join("\n")}\n`;
			},
		},
		{ defaultFormat: "text" },
	)
	.action(async (args, _flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.getPrototype(args.name);
			return envelope.value;
		} catch (err) {
			handleClientError(err, ctx);
		}
	});

cli
	.command("prototype")
	.command("add")
	.describe("Register a new prototype")
	.arg("name", "Prototype name")
	.flag("model", { type: "string", description: "Model registry name" })
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
				"Usage: sumeru prototype add <name> --model <model-name> --adapter <adapter-name> [--persona <name>]",
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
	.flag("model", { type: "string", description: "Model registry name" })
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
	.flag("limit", { type: "number", description: "Max results (default 50)" })
	.flag("offset", { type: "number", description: "Skip first N results" })
	.returns(listSchema, {
		text: (value) => {
			const rows = value as PaginatedArray<Record<string, unknown>>;
			if (rows.length === 0) return "(empty)\n";
			let output = rows
				.map((p) => `[${p.name}]\n${p.instructions ?? ""}\n`)
				.join("\n");
			const total = rows._total;
			const offset = rows._offset ?? 0;
			if (total !== undefined && offset + rows.length < total) {
				output += `(${String(rows.length)} of ${String(total)} shown. Use --offset ${String(offset + rows.length)} to see more.)\n`;
			}
			return output;
		},
	})
	.action(async (_args, flags, ctx) => {
		const limit = (flags.limit as number | undefined) ?? 50;
		const offset = (flags.offset as number | undefined) ?? 0;
		const client = await getClient();
		try {
			const envelope = await client.listPersonas();
			const all = envelope.value;
			const page = all.slice(offset, offset + limit) as PaginatedArray<
				Record<string, unknown>
			>;
			page._total = all.length;
			page._offset = offset;
			return page;
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
		{
			text: (value) => {
				const v = value as Record<string, unknown>;
				return `${[`Name: ${v.name}`, `Instructions: ${v.instructions}`]
					.filter(Boolean)
					.join("\n")}\n`;
			},
		},
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
	.flag("limit", { type: "number", description: "Max results (default 50)" })
	.flag("offset", { type: "number", description: "Skip first N results" })
	.returns(listSchema, {
		text: (value) => {
			const rows = value as PaginatedArray<Record<string, unknown>>;
			const mapped = rows.map((s) => ({
				...s,
				task:
					typeof s.task === "string" && s.task.length > 50
						? `${s.task.slice(0, 47)}...`
						: s.task,
			})) as PaginatedArray<Record<string, unknown>>;
			mapped._total = rows._total;
			mapped._offset = rows._offset;
			return formatTableWithPagination(mapped, [
				"id",
				"prototype",
				"status",
				"task",
			]);
		},
	})
	.action(async (_args, flags, ctx) => {
		const limit = (flags.limit as number | undefined) ?? 50;
		const offset = (flags.offset as number | undefined) ?? 0;
		const client = await getClient();
		try {
			const envelope = await client.listSessions();
			const all = envelope.value;
			const page = all.slice(offset, offset + limit) as PaginatedArray<
				Record<string, unknown>
			>;
			page._total = all.length;
			page._offset = offset;
			return page;
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
		z.object({
			id: z.string(),
			prototype: z.string(),
			status: z.string(),
			task: z.string().nullable(),
		}),
		{
			text: (value) => {
				const v = value as Record<string, unknown>;
				return `${[
					`ID: ${v.id}`,
					`Prototype: ${v.prototype}`,
					`Status: ${v.status}`,
					v.task ? `Task: ${v.task}` : null,
				]
					.filter(Boolean)
					.join("\n")}\n`;
			},
		},
		{ defaultFormat: "text" },
	)
	.action(async (args, _flags, ctx) => {
		const client = await getClient();
		try {
			const envelope = await client.getSession(args.id);
			return envelope.value;
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

		if (!follow) {
			try {
				const envelope = await client.getTurns(args.id);
				for (const turn of envelope.value) {
					ctx.stdout(`${formatTurnLogLine(turn)}\n`);
				}
				return undefined;
			} catch (err) {
				handleClientError(err, ctx);
			}
		}

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
			while (!gotExit) {
				gotExit = false;
				await client.streamEvents(args.id, printEvent);
			}
			return undefined;
		} catch (err) {
			if (gotExit && isStreamCloseError(err)) {
				return undefined;
			}
			handleClientError(err, ctx);
		}
	});

cli
	.command("session")
	.command("turns")
	.describe("List turns for a session")
	.arg("id", "Session ID")
	.flag("after", { type: "number", description: "Show turns after this ID" })
	.flag("watch", {
		type: "boolean",
		alias: "w",
		description: "Watch turns (subscribe + history pull)",
	})
	.flag("system", { type: "boolean", description: "Include system prompt" })
	.flag("limit", { type: "number", description: "Max results (default 50)" })
	.flag("offset", { type: "number", description: "Skip first N results" })
	.returns(listSchema, {
		text: (value) => {
			const turns = value as PaginatedArray<Record<string, unknown>>;
			if (turns.length === 0) return "(empty)\n";
			let output = turns
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
			const total = turns._total;
			const offset = turns._offset ?? 0;
			if (total !== undefined && offset + turns.length < total) {
				output += `(${String(turns.length)} of ${String(total)} shown. Use --offset ${String(offset + turns.length)} to see more.)\n`;
			}
			return output;
		},
	})
	.action(async (args, flags, ctx) => {
		const watch = Boolean(flags.watch);
		const system = Boolean(flags.system);
		const client = await getClient();

		if (watch) {
			try {
				const { connectedAt, stream } = await client.watchTurns(args.id);
				const history = await client.getTurns(args.id, {
					before: connectedAt,
					system,
				});
				for (const turn of history.value) {
					ctx.stdout(`${formatWatchTurnLine(turn)}\n`);
				}
				ctx.stdout("---\n");
				for await (const { event, data } of stream) {
					if (event === "turn") {
						const turn = JSON.parse(data) as Turn;
						ctx.stdout(`${formatWatchTurnLine(turn)}\n`);
					} else if (event === "exit") {
						const exit = JSON.parse(data) as {
							type: string;
							message: string;
						};
						ctx.stdout(`[exit] ${exit.type}: ${exit.message}\n`);
					}
				}
				return undefined;
			} catch (err) {
				handleClientError(err, ctx);
			}
		}

		const limit = (flags.limit as number | undefined) ?? 50;
		const offset = (flags.offset as number | undefined) ?? 0;
		const after = flags.after !== undefined ? Number(flags.after) : undefined;
		try {
			const envelope = await client.getTurns(args.id, { after, system });
			const all = envelope.value;
			const page = all.slice(offset, offset + limit) as PaginatedArray<
				Record<string, unknown>
			>;
			page._total = all.length;
			page._offset = offset;
			return page;
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
			return {
				message: `Snapshot created\n  Name:  ${snapshotResult.name}\n  Image: ${snapshotResult.image}`,
			};
		} catch (err) {
			if (err instanceof ApiClientError) {
				ctx.error(`${err.code}: ${err.message}`);
			}
			const msg = err instanceof Error ? err.message : String(err);
			ctx.error(msg);
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

// Handle session exec before CLI dispatch (-- separator confuses cli-kit parser)
if (argv[0] === "session" && argv[1] === "exec") {
	const separatorIdx = argv.indexOf("--");
	const sessionId = argv[2];
	if (!sessionId || sessionId.startsWith("-")) {
		process.stdout.write("Usage: sumeru session exec <id> -- <command...>\n");
		process.exit(1);
	}
	if (separatorIdx === -1 || separatorIdx < 3) {
		process.stdout.write("Usage: sumeru session exec <id> -- <command...>\n");
		process.exit(1);
	}
	const parts = argv.slice(separatorIdx + 1);
	if (parts.length === 0) {
		process.stdout.write("Usage: sumeru session exec <id> -- <command...>\n");
		process.exit(1);
	}
	const { createApiClient } = await import("./api-client.js");
	const { resolveBaseUrl } = await import("./lazy.js");
	const command = parts.join(" ");
	const api = createApiClient(resolveBaseUrl());
	try {
		const result = await api.postCommand(sessionId, {
			type: "exec",
			command,
		});
		if (result.mode !== "sync" || result.value.type !== "exec") {
			process.stderr.write("Error: Expected sync exec result\n");
			process.exit(1);
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
		const msg = err instanceof Error ? err.message : String(err);
		process.stderr.write(`Error: ${msg}\n`);
		process.exit(1);
	}
}

const modelExitCode = await runSessionModelCommand(argv);
if (modelExitCode !== null) {
	process.exit(modelExitCode);
}

const exitCode = await cli.run();
process.exit(exitCode);
