import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { Tool, ToolContext, ToolResult } from "../types.js";

function resolvePath(cwd: string, path: string): string {
	return isAbsolute(path) ? path : resolve(cwd, path);
}

async function run(fn: () => Promise<string>): Promise<ToolResult> {
	const start = Date.now();
	try {
		const output = await fn();
		return { output, exitCode: 0, durationMs: Date.now() - start };
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return {
			output: `Error: ${msg}`,
			exitCode: 1,
			durationMs: Date.now() - start,
		};
	}
}

export const readFileTool: Tool = {
	name: "read_file",
	description:
		"Read a text file. Returns content with line numbers (LINE|content). Use offset (1-indexed) and limit to paginate.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string", description: "absolute or cwd-relative path" },
			offset: {
				type: "number",
				description: "1-indexed start line (default 1)",
			},
			limit: { type: "number", description: "max lines (default 500)" },
		},
		required: ["path"],
	},
	async execute(
		args: Record<string, unknown>,
		ctx: ToolContext,
	): Promise<ToolResult> {
		const path = typeof args.path === "string" ? args.path : "";
		const offset = typeof args.offset === "number" ? args.offset : 1;
		const limit = typeof args.limit === "number" ? args.limit : 500;
		if (path.length === 0) {
			return { output: "Error: path required", exitCode: 1, durationMs: null };
		}
		return run(async () => {
			const resolved = resolvePath(ctx.cwd, path);
			const raw = await readFile(resolved, "utf8");
			const lines = raw.split("\n");
			const start = Math.max(0, offset - 1);
			const end = Math.min(lines.length, start + limit);
			const out: Array<string> = [];
			for (let i = start; i < end; i += 1) {
				out.push(`${i + 1}|${lines[i] ?? ""}`);
			}
			return out.join("\n");
		});
	},
};

export const writeFileTool: Tool = {
	name: "write_file",
	description:
		"Write content to a file, overwriting entirely. Creates parent dirs.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string" },
			content: { type: "string" },
		},
		required: ["path", "content"],
	},
	async execute(
		args: Record<string, unknown>,
		ctx: ToolContext,
	): Promise<ToolResult> {
		const path = typeof args.path === "string" ? args.path : "";
		const content = typeof args.content === "string" ? args.content : "";
		if (path.length === 0) {
			return { output: "Error: path required", exitCode: 1, durationMs: null };
		}
		return run(async () => {
			const resolved = resolvePath(ctx.cwd, path);
			await mkdir(dirname(resolved), { recursive: true });
			await writeFile(resolved, content, "utf8");
			return `wrote ${resolved} (${content.length} bytes)`;
		});
	},
};

export const patchTool: Tool = {
	name: "patch",
	description:
		"Replace old_string with new_string in a file. Fails if old_string not found or not unique.",
	parameters: {
		type: "object",
		properties: {
			path: { type: "string" },
			old_string: { type: "string" },
			new_string: { type: "string" },
		},
		required: ["path", "old_string", "new_string"],
	},
	async execute(
		args: Record<string, unknown>,
		ctx: ToolContext,
	): Promise<ToolResult> {
		const path = typeof args.path === "string" ? args.path : "";
		const oldS = typeof args.old_string === "string" ? args.old_string : "";
		const newS = typeof args.new_string === "string" ? args.new_string : "";
		if (path.length === 0 || oldS.length === 0) {
			return {
				output: "Error: path and old_string required",
				exitCode: 1,
				durationMs: null,
			};
		}
		return run(async () => {
			const resolved = resolvePath(ctx.cwd, path);
			const raw = await readFile(resolved, "utf8");
			const parts = raw.split(oldS);
			if (parts.length < 2) throw new Error("old_string not found");
			if (parts.length > 2) throw new Error("old_string not unique");
			const next = parts[0] + newS + parts[1];
			await writeFile(resolved, next, "utf8");
			return `patched ${resolved}`;
		});
	},
};
