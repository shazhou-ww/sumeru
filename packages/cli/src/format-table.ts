export function formatTable(
	rows: Array<Record<string, unknown>>,
	columns: string[],
): string {
	if (rows.length === 0) return "(empty)\n";
	const widths = columns.map((col) =>
		Math.max(col.length, ...rows.map((r) => String(r[col] ?? "").length)),
	);
	const header = columns
		.map((c, i) => c.toUpperCase().padEnd(widths[i]!))
		.join("  ");
	const sep = widths.map((w) => "-".repeat(w)).join("  ");
	const body = rows
		.map((r) =>
			columns.map((c, i) => String(r[c] ?? "").padEnd(widths[i]!)).join("  "),
		)
		.join("\n");
	return `${header}\n${sep}\n${body}\n`;
}
