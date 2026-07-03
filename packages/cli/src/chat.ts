import type { CliContext } from "@ocas/cli-kit";
import type { Turn } from "@sumeru/core";
import { z } from "zod";
import {
	ApiClientError,
	createApiClient,
	resolveApiBaseUrl,
} from "./api-client.js";
import { resolveInput } from "./input.js";
import { resolveTarget } from "./target.js";

const messageSchema = z.object({ message: z.string() });

function handleApiError(err: unknown, ctx: CliContext): never {
	if (err instanceof ApiClientError) {
		ctx.error(`${err.code}: ${err.message}`);
	}
	const msg = err instanceof Error ? err.message : String(err);
	ctx.error(msg);
}

function formatTurn(turn: Turn): string {
	if (turn.role === "assistant") {
		return turn.content;
	}
	return `[tool:${turn.name}] ${turn.result}\n`;
}

type CliBuilder = {
	command(name: string): CliBuilder;
	describe(text: string): CliBuilder;
	arg(name: string): CliBuilder;
	flag(name: string, def: { type: string; alias?: string }): CliBuilder;
	returns(
		schema: z.ZodType,
		template: string,
		config?: { defaultFormat?: string },
	): CliBuilder;
	action(
		fn: (
			args: Record<string, string>,
			flags: Record<string, unknown>,
			ctx: CliContext,
		) => Promise<unknown>,
	): CliBuilder;
};

export function registerChatCommand(cli: CliBuilder): void {
	cli
		.command("chat")
		.describe("Send a chat message to a session or prototype")
		.arg("target")
		.flag("file", { type: "string", alias: "f" })
		.flag("host", { type: "string" })
		.flag("port", { type: "string" })
		.returns(messageSchema, "{{message}}", { defaultFormat: "text" })
		.action(async (args, flags, ctx) => {
			const positionals = flags._positionals as Array<string> | undefined;
			const promptArgs = positionals?.slice(1) ?? [];
			const content = resolveInput(
				promptArgs,
				(flags.file as string | undefined) ?? null,
			);
			if (content === null || content.length === 0) {
				ctx.error(
					"Usage: sumeru chat <target> [prompt] | -f <file> | stdin pipe",
				);
				return;
			}
			const message = content;
			const api = createApiClient(
				resolveApiBaseUrl({
					host: flags.host as string | undefined,
					port: flags.port as string | undefined,
				}),
			);
			try {
				const sessionId = await resolveTarget(args.target, api);
				const result = await api.postCommand(sessionId, {
					type: "chat",
					content: message,
					messageId: null,
					env: null,
					model: null,
				});
				if (result.mode !== "async") {
					ctx.error("Expected async chat command");
				}
				let done = false;
				await api.streamEvents(sessionId, (event, data) => {
					if (event === "heartbeat") return;
					if (event === "turn") {
						const turn = JSON.parse(data) as Turn;
						process.stdout.write(formatTurn(turn));
						return;
					}
					if (event === "exit") {
						done = true;
					}
				});
				if (!done) {
					ctx.error("Chat stream ended without exit event");
				}
				return undefined;
			} catch (err) {
				handleApiError(err, ctx);
			}
		});
}
