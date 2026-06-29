import type { SessionInfo } from "@sumeru/core";
import type { HostRootValue, PrototypeListItem } from "./http-client.js";

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

function pad(value: string, width: number): string {
	if (value.length >= width) {
		return value.slice(0, width);
	}
	return value.padEnd(width);
}
