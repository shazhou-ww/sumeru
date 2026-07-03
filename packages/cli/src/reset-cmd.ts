import type { CliContext } from "@ocas/cli-kit";
import { z } from "zod";
import {
	ApiClientError,
	createApiClient,
	resolveApiBaseUrl,
} from "./api-client.js";
import { resolveInput } from "./input.js";

const messageSchema = z.object({ message: z.string() });

function handleApiError(err: unknown, ctx: CliContext): never {
	if (err instanceof ApiClientError) {
		ctx.error(`${err.code}: ${err.message}`);
	}
	const msg = err instanceof Error ? err.message : String(err);
	ctx.error(msg);
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

export function registerResetCommand(cli: CliBuilder): void {
	cli
		.command("reset")
		.describe("Reset a session, optionally with a new persona")
		.arg("session")
		.flag("file", { type: "string", alias: "f" })
		.flag("host", { type: "string" })
		.flag("port", { type: "string" })
		.returns(messageSchema, "{{message}}", { defaultFormat: "text" })
		.action(async (args, flags, ctx) => {
			const persona = resolveInput(
				[],
				(flags.file as string | undefined) ?? null,
			);
			const api = createApiClient(
				resolveApiBaseUrl({
					host: flags.host as string | undefined,
					port: flags.port as string | undefined,
				}),
			);
			try {
				const body =
					persona === null
						? { type: "reset" as const, persona: null }
						: { type: "reset" as const, persona };
				const result = await api.postCommand(args.session, body);
				if (result.mode !== "sync" || result.value.type !== "reset") {
					ctx.error("Expected sync reset result");
				}
				return { message: `reset ${args.session}` };
			} catch (err) {
				handleApiError(err, ctx);
			}
		});
}
