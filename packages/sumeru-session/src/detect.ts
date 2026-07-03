import { spawnSync } from "node:child_process";

export type DetectedAdapter =
	| "codex"
	| "hermes"
	| "claude-code"
	| "cursor-agent"
	| "sarsapa";

type CliProbe = {
	adapter: DetectedAdapter;
	command: string;
};

const CLI_PROBES: Array<CliProbe> = [
	{ adapter: "codex", command: "codex" },
	{ adapter: "hermes", command: "hermes" },
	{ adapter: "claude-code", command: "claude" },
	{ adapter: "cursor-agent", command: "cursor-agent" },
];

export function isCommandAvailable(command: string): boolean {
	const result = spawnSync(
		"sh",
		["-c", `command -v -- ${quoteShellWord(command)}`],
		{
			stdio: "ignore",
		},
	);
	return result.status === 0;
}

export function detectAdapter(
	isAvailable: (command: string) => boolean = isCommandAvailable,
): DetectedAdapter {
	for (const probe of CLI_PROBES) {
		if (isAvailable(probe.command)) {
			return probe.adapter;
		}
	}
	return "sarsapa";
}

function quoteShellWord(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}
