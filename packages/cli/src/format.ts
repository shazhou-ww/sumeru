import type { Model, Persona, Provider, SessionInfo } from "@sumeru/core";
import type {
	AdapterInfo,
	BuiltinModel,
	ExtensionInfo,
	HostRootValue,
	PrototypeListItem,
} from "./http-client.js";

export type TableColumn<T> = {
	header: string;
	width: number;
	value: (row: T) => string;
};

export function formatTable<T>(
	rows: Array<T>,
	columns: Array<TableColumn<T>>,
): string {
	if (rows.length === 0) {
		return "(empty)";
	}
	const header = columns.map((col) => pad(col.header, col.width)).join("  ");
	const separator = columns.map((col) => "-".repeat(col.width)).join("  ");
	const body = rows.map((row) =>
		columns.map((col) => pad(col.value(row), col.width)).join("  "),
	);
	return [header, separator, ...body].join("\n");
}

export function formatHostStatus(root: HostRootValue): string {
	const lines = [
		`name:     ${root.name}`,
		`version:  ${root.version}`,
		`running:  ${String(root.status.running)}`,
		`queued:   ${String(root.status.queued)}`,
		`idle:     ${String(root.status.idle)}`,
		`uptime:   ${String(root.uptime)}s`,
	];
	return lines.join("\n");
}

export function formatPrototypeTable(
	prototypes: Array<PrototypeListItem>,
): string {
	return formatTable(prototypes, [
		{ header: "NAME", width: 24, value: (row) => row.name },
	]);
}

export function formatProviderTable(providers: Array<Provider>): string {
	return formatTable(providers, [
		{ header: "NAME", width: 20, value: (row) => row.name },
		{ header: "API TYPE", width: 12, value: (row) => row.apiType },
		{ header: "BASE URL", width: 32, value: (row) => row.baseUrl ?? "-" },
		{ header: "API KEY", width: 16, value: (row) => row.apiKey ?? "-" },
	]);
}

export function formatAdapterTable(adapters: Array<AdapterInfo>): string {
	return formatTable(adapters, [
		{ header: "NAME", width: 20, value: (row) => row.name },
		{ header: "MODE", width: 14, value: (row) => row.providerMode },
		{
			header: "CREDENTIAL ENV",
			width: 20,
			value: (row) => row.credentialEnv ?? "-",
		},
		{
			header: "MODELS",
			width: 7,
			value: (row) => (row.listModels ? "yes" : "no"),
		},
	]);
}

export function formatAdapterModelTable(models: Array<BuiltinModel>): string {
	return formatTable(models, [
		{ header: "ID", width: 36, value: (row) => row.id },
		{ header: "NAME", width: 28, value: (row) => row.name },
		{
			header: "CTX",
			width: 10,
			value: (row) =>
				row.contextWindow === null ? "-" : String(row.contextWindow),
		},
	]);
}

export function formatModelTable(models: Array<Model>): string {
	return formatTable(models, [
		{ header: "NAME", width: 20, value: (row) => row.name },
		{ header: "PROVIDER", width: 16, value: (row) => row.provider },
		{ header: "MODEL", width: 24, value: (row) => row.model },
		{
			header: "CTX",
			width: 8,
			value: (row) =>
				row.contextWindow === null ? "-" : String(row.contextWindow),
		},
		{
			header: "TOOLS",
			width: 6,
			value: (row) => (row.toolUse ? "yes" : "no"),
		},
		{
			header: "STREAM",
			width: 7,
			value: (row) => (row.streaming ? "yes" : "no"),
		},
	]);
}

export function formatSessionTable(sessions: Array<SessionInfo>): string {
	return formatTable(sessions, [
		{ header: "ID", width: 28, value: (row) => row.id },
		{ header: "PROTOTYPE", width: 16, value: (row) => row.prototype },
		{ header: "STATUS", width: 12, value: (row) => row.status },
		{ header: "PROJECT", width: 20, value: (row) => row.project },
		{ header: "TASK", width: 24, value: (row) => row.task },
	]);
}

export function formatDockerImagesOutput(stdout: string): string {
	const lines = stdout
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0);
	if (lines.length <= 1) {
		return "(no sumeru/* images found)";
	}
	return lines.join("\n");
}

export function formatPersonaTable(personas: Array<Persona>): string {
	return formatTable(personas, [
		{ header: "NAME", width: 20, value: (row) => row.name },
		{
			header: "SKILLS",
			width: 40,
			value: (row) => row.skills.join(", ") || "(none)",
		},
		{ header: "UPDATED", width: 24, value: (row) => row.updatedAt },
	]);
}

export function formatExtensionTable(extensions: Array<ExtensionInfo>): string {
	return formatTable(extensions, [
		{ header: "NAME", width: 20, value: (row) => row.name },
		{ header: "DESCRIPTION", width: 40, value: (row) => row.description },
	]);
}

function pad(value: string, width: number): string {
	if (value.length >= width) {
		return value.slice(0, width);
	}
	return value.padEnd(width);
}
