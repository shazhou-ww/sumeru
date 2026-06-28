import type { ToolSchema } from "../llm/types.js";
import type { Tool, ToolContext } from "../types.js";
import { patchTool, readFileTool, writeFileTool } from "./file.js";
import { searchTool } from "./search.js";
import { terminalTool } from "./terminal.js";

export function defaultTools(): Array<Tool> {
	return [readFileTool, writeFileTool, patchTool, terminalTool, searchTool];
}

export function toSchemas(tools: Array<Tool>): Array<ToolSchema> {
	return tools.map((t) => ({
		type: "function" as const,
		function: {
			name: t.name,
			description: t.description,
			parameters: t.parameters,
		},
	}));
}

export function findTool(tools: Array<Tool>, name: string): Tool | null {
	for (const t of tools) {
		if (t.name === name) return t;
	}
	return null;
}

export type { Tool, ToolContext };
