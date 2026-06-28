import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Tool, ToolContext, ToolResult } from "../types.js";

const execAsync = promisify(exec);

export const terminalTool: Tool = {
	name: "terminal",
	description:
		"Execute a shell command (foreground). Returns stdout (and stderr if any). Use timeout to limit.",
	parameters: {
		type: "object",
		properties: {
			command: { type: "string" },
			timeout: { type: "number", description: "max ms (default 60000)" },
		},
		required: ["command"],
	},
	async execute(
		args: Record<string, unknown>,
		ctx: ToolContext,
	): Promise<ToolResult> {
		const command = typeof args.command === "string" ? args.command : "";
		const timeout = typeof args.timeout === "number" ? args.timeout : 60000;
		if (command.length === 0) {
			return {
				output: "Error: command required",
				exitCode: 1,
				durationMs: null,
			};
		}
		const start = Date.now();
		try {
			const res = await execAsync(command, {
				cwd: ctx.cwd,
				timeout,
				maxBuffer: 1024 * 1024 * 5,
			});
			const out = (
				res.stdout + (res.stderr.length > 0 ? `\n[stderr]\n${res.stderr}` : "")
			).trimEnd();
			return { output: out, exitCode: 0, durationMs: Date.now() - start };
		} catch (err) {
			const e = err as {
				stdout?: string;
				stderr?: string;
				code?: number;
				message?: string;
			};
			const parts: Array<string> = [];
			if (typeof e.stdout === "string" && e.stdout.length > 0)
				parts.push(e.stdout);
			if (typeof e.stderr === "string" && e.stderr.length > 0) {
				parts.push(`[stderr]\n${e.stderr}`);
			}
			if (typeof e.message === "string") parts.push(`[error]\n${e.message}`);
			return {
				output: parts.join("\n").trimEnd() || "(no output)",
				exitCode: typeof e.code === "number" ? e.code : 1,
				durationMs: Date.now() - start,
			};
		}
	},
};
