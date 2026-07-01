export function parseEnvPair(raw: string): { key: string; value: string } {
	const eq = raw.indexOf("=");
	if (eq <= 0) {
		throw new Error(`Invalid --env value "${raw}": expected KEY=VALUE`);
	}
	const key = raw.slice(0, eq).trim();
	if (key.length === 0) {
		throw new Error(`Invalid --env value "${raw}": expected KEY=VALUE`);
	}
	return { key, value: raw.slice(eq + 1) };
}

export function parseEnvFlagsFromArgv(
	argv: string[],
): Record<string, string> | null {
	const env: Record<string, string> = {};
	let found = false;
	for (let i = 0; i < argv.length; i++) {
		const token = argv[i] as string;
		if (token === "--env") {
			const value = argv[i + 1];
			if (value === undefined || value.startsWith("-")) {
				throw new Error("Missing value for --env");
			}
			const pair = parseEnvPair(value);
			env[pair.key] = pair.value;
			found = true;
			i++;
			continue;
		}
		if (token.startsWith("--env=")) {
			const value = token.slice("--env=".length);
			const pair = parseEnvPair(value);
			env[pair.key] = pair.value;
			found = true;
		}
	}
	return found ? env : null;
}
