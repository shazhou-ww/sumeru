import { execFile } from "node:child_process";
import { isAbsolute, resolve } from "node:path";
import { promisify } from "node:util";
import type { Tool, ToolContext, ToolResult } from "../types.js";

const execFileAsync = promisify(execFile);

function resolvePath(cwd: string, path: string): string {
	return isAbsolute(path) ? path : resolve(cwd, path);
}

export const searchTool: Tool = {
	name: "search_files",
	description:
		"Search file contents with ripgrep regex (mode=content, returns matches with line numbers) or list files by glob (mode=files).",
	parameters: {
		type: "object",
		properties: {
			pattern: { type: "string" },
			path: { type: "string", description: "dir to search (default cwd)" },
			mode: {
				type: "string",
				enum: ["content", "files"],
				description: "content=grep, files=glob (default content)",
			},
		},
		required: ["pattern"],
	},
	async execute(
		args: Record<string, unknown>,
		ctx: ToolContext,
	): Promise<ToolResult> {
		const pattern = typeof args.pattern === "string" ? args.pattern : "";
		const pathArg = typeof args.path === "string" ? args.path : ctx.cwd;
		const mode = typeof args.mode === "string" ? args.mode : "content";
		if (pattern.length === 0) {
			return {
				output: "Error: pattern required",
				exitCode: 1,
				durationMs: null,
			};
		}
		const target = resolvePath(ctx.cwd, pathArg);
		const start = Date.now();
		try {
			let res: { stdout: string; stderr: string };
			if (mode === "files") {
				res = await execFileAsync("rg", ["--files", "-g", pattern, target], {
					cwd: ctx.cwd,
					timeout: 30000,
					maxBuffer: 1024 * 1024 * 2,
				});
			} else {
				res = await execFileAsync("rg", ["-n", pattern, target], {
					cwd: ctx.cwd,
					timeout: 30000,
					maxBuffer: 1024 * 1024 * 2,
				});
			}
			return {
				output: res.stdout.trimEnd() || "(no matches)",
				exitCode: 0,
				durationMs: Date.now() - start,
			};
		} catch (err) {
			const e = err as { stdout?: string; code?: number };
			// rg exit code 1 = no matches (not an error)
			if (e.code === 1) {
				return {
					output: "(no matches)",
					exitCode: 0,
					durationMs: Date.now() - start,
				};
			}
			return {
				output: typeof e.stdout === "string" ? e.stdout : "search failed",
				exitCode: typeof e.code === "number" ? e.code : 1,
				durationMs: Date.now() - start,
			};
		}
	},
};
