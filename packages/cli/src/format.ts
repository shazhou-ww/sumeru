import type { InstanceInfo } from "@sumeru/core";
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
		`name:        ${root.name}`,
		`version:     ${root.version}`,
		`master:      ${root.master}`,
		`prototypes:  ${root.prototypes.join(", ") || "(none)"}`,
		`instances:   ${root.instances.join(", ") || "(none)"}`,
	];
	return lines.join("\n");
}

export function formatPrototypeTable(
	prototypes: Array<PrototypeListItem>,
): string {
	return formatTable(prototypes, [
		{ header: "NAME", width: 24, value: (row) => row.name },
		{ header: "ADAPTER", width: 16, value: (row) => row.adapter },
	]);
}

export function formatInstanceTable(instances: Array<InstanceInfo>): string {
	return formatTable(instances, [
		{ header: "ID", width: 28, value: (row) => row.id },
		{
			header: "PROTOTYPE",
			width: 16,
			value: (row) => row.prototype ?? "master",
		},
		{ header: "STATUS", width: 12, value: (row) => row.status },
		{
			header: "PROJECTS",
			width: 24,
			value: (row) => (row.projects.length > 0 ? row.projects.join(",") : "-"),
		},
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
