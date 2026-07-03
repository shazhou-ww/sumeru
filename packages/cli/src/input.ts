import { readFileSync } from "node:fs";

export function readStdinSync(): string {
	return readFileSync(0, "utf-8");
}

export function resolveInput(
	args: Array<string>,
	fileFlag: string | null,
): string | null {
	if (fileFlag !== null && fileFlag.length > 0) {
		return readFileSync(fileFlag, "utf-8");
	}
	if (args.length > 0) {
		return args.join(" ");
	}
	if (!process.stdin.isTTY) {
		return readFileSync(0, "utf-8");
	}
	return null;
}
