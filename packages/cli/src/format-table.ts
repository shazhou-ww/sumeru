export type PaginatedArray<T> = Array<T> & {
	_total?: number;
	_offset?: number;
};

export function formatTableWithPagination(
	value: unknown,
	columns: string[],
): string {
	const rows = value as PaginatedArray<Record<string, unknown>>;
	if (rows.length === 0) return "(empty)\n";
	const total = rows._total;
	const offset = rows._offset ?? 0;
	let output = formatTable(rows, columns, offset + 1);
	if (total !== undefined && offset + rows.length < total) {
		output += `(${String(rows.length)} of ${String(total)} shown. Use --offset ${String(offset + rows.length)} to see more.)\n`;
	}
	return output;
}

export function formatTable(
	rows: Array<Record<string, unknown>>,
	columns: string[],
	startIndex = 1,
): string {
	if (rows.length === 0) return "(empty)\n";
	const maxIdx = startIndex + rows.length - 1;
	const numWidth = Math.max(1, String(maxIdx).length);
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
				`${String(startIndex + idx).padEnd(numWidth)}  ` +
				// biome-ignore lint/style/noNonNullAssertion: widths array matches columns length
				columns.map((c, i) => String(r[c] ?? "").padEnd(widths[i]!)).join("  "),
		)
		.join("\n");
	return `${header}\n${sep}\n${body}\n`;
}
