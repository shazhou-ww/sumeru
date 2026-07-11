import type { CliContext } from "@ocas/cli-kit";
import { z } from "zod";
import {
	ApiClientError,
	createApiClient,
	resolveApiBaseUrl,
} from "./api-client.js";

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
	flag(name: string, def: { type: string }): CliBuilder;
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

export function registerPrototypeRmCommand(cli: CliBuilder): void {
	cli
		.command("prototype")
		.command("rm")
		.describe("Remove a prototype")
		.arg("name")
		.flag("host", { type: "string" })
		.flag("port", { type: "string" })
		.returns(messageSchema, "{{message}}", { defaultFormat: "text" })
		.action(async (args, flags, ctx) => {
			const api = createApiClient(
				resolveApiBaseUrl({
					host: flags.host as string | undefined,
					port: flags.port as string | undefined,
				}),
			);
			try {
				await api.delete(`/prototypes/${encodeURIComponent(args.name)}`);
				return { message: `Removed prototype ${args.name}` };
			} catch (err) {
				handleApiError(err, ctx);
			}
		});
}
