export function formatTable(
	rows: Array<Record<string, unknown>>,
	columns: string[],
): string {
	if (rows.length === 0) return "(empty)\n";
	const numWidth = Math.max(1, String(rows.length).length);
	const widths = columns.map((col) =>
		Math.max(col.length, ...rows.map((r) => String(r[col] ?? "").length)),
	);
	const numHeader = "#".padEnd(numWidth);
	const header =
		`${numHeader}  ` +
		columns
			// biome-ignore lint/style/noNonNullAssertion: widths array matches columns length
			.map((c, i) => c.toUpperCase().padEnd(widths[i]!))
			.join("  ");
	const sep = `${"-".repeat(numWidth)}  ${widths.map((w) => "-".repeat(w)).join("  ")}`;
	const body = rows
		.map(
			(r, idx) =>
				`${String(idx + 1).padEnd(numWidth)}  ` +
				// biome-ignore lint/style/noNonNullAssertion: widths array matches columns length
				columns.map((c, i) => String(r[c] ?? "").padEnd(widths[i]!)).join("  "),
		)
		.join("\n");
	return `${header}\n${sep}\n${body}\n`;
}
