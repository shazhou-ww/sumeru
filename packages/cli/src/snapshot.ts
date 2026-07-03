import type { CliContext } from "@ocas/cli-kit";
import { z } from "zod";
import {
	ApiClientError,
	type CommandResultValue,
	createApiClient,
	resolveApiBaseUrl,
} from "./api-client.js";

const snapshotResultSchema = z.object({
	name: z.string(),
	image: z.string(),
});

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

export function registerSnapshotCommand(cli: CliBuilder): void {
	cli
		.command("snapshot")
		.describe("Snapshot a session into a new prototype image")
		.arg("session")
		.arg("name")
		.flag("host", { type: "string" })
		.flag("port", { type: "string" })
		.returns(snapshotResultSchema, "{{name}} {{image}}", {
			defaultFormat: "text",
		})
		.action(async (args, flags, ctx) => {
			const api = createApiClient(
				resolveApiBaseUrl({
					host: flags.host as string | undefined,
					port: flags.port as string | undefined,
				}),
			);
			try {
				const result = await api.postCommand(args.session, {
					type: "snapshot",
					name: args.name,
				});
				if (result.mode !== "sync" || result.value.type !== "snapshot") {
					ctx.error("Expected sync snapshot result");
				}
				const snapshotResult = result.value as Extract<
					CommandResultValue,
					{ type: "snapshot" }
				>;
				return {
					name: snapshotResult.name,
					image: snapshotResult.image,
				};
			} catch (err) {
				handleApiError(err, ctx);
			}
		});
}
