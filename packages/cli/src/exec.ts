import type { CliContext } from "@ocas/cli-kit";
import { z } from "zod";
import {
	ApiClientError,
	type CommandResultValue,
	createApiClient,
	resolveApiBaseUrl,
} from "./api-client.js";
import { resolveTarget } from "./target.js";

const messageSchema = z.object({ message: z.string() });

function handleApiError(err: unknown, ctx: CliContext): never {
	if (err instanceof ApiClientError) {
		ctx.error(`${err.code}: ${err.message}`);
	}
	const msg = err instanceof Error ? err.message : String(err);
	ctx.error(msg);
}

function parseExecCommand(argv: Array<string>): string | null {
	const separator = argv.indexOf("--");
	if (separator === -1) return null;
	const parts = argv.slice(separator + 1);
	if (parts.length === 0) return null;
	return parts.join(" ");
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

export function registerExecCommand(cli: CliBuilder): void {
	cli
		.command("exec")
		.describe("Run a shell command in a session container")
		.arg("target")
		.flag("host", { type: "string" })
		.flag("port", { type: "string" })
		.returns(messageSchema, "{{message}}", { defaultFormat: "text" })
		.action(async (args, flags, ctx) => {
			const command = parseExecCommand(process.argv.slice(2));
			if (command === null) {
				ctx.error("Usage: sumeru exec <target> -- <command...>");
				return;
			}
			const shellCommand: string = command;
			const api = createApiClient(
				resolveApiBaseUrl({
					host: flags.host as string | undefined,
					port: flags.port as string | undefined,
				}),
			);
			try {
				const sessionId = await resolveTarget(args.target, api);
				const result = await api.postCommand(sessionId, {
					type: "exec",
					command: shellCommand,
				});
				if (result.mode !== "sync" || result.value.type !== "exec") {
					ctx.error("Expected sync exec result");
				}
				const execResult = result.value as Extract<
					CommandResultValue,
					{ type: "exec" }
				>;
				process.stdout.write(execResult.stdout);
				if (execResult.stderr.length > 0) {
					process.stderr.write(execResult.stderr);
				}
				process.exit(execResult.exitCode);
			} catch (err) {
				handleApiError(err, ctx);
			}
		});
}
