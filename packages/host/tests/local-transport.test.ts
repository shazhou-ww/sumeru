import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
	createLocalTransportImpl,
	LOCAL_MASTER_HANDLE,
} from "../src/local-transport.js";

describe("local-transport", () => {
	it("create returns fixed master handle", () => {
		const local = createLocalTransportImpl({
			adapterCommand: ["node", "-e", "process.exit(0)"],
		});
		expect(local.create()).toBe(LOCAL_MASTER_HANDLE);
	});

	it("spawn pipes stdin/stdout for adapter NDJSON", async () => {
		const local = createLocalTransportImpl({
			adapterCommand: [
				"node",
				"-e",
				[
					"process.stdin.on('data', (chunk) => {",
					"  const text = chunk.toString('utf8');",
					"  if (text.includes('init')) {",
					"    process.stdout.write(JSON.stringify({ type: 'ready', value: {} }) + '\\n');",
					"  }",
					"});",
				].join(""),
			],
		});
		const handleId = local.create();
		const session = local.spawn(handleId, [], null);
		const lines: Array<string> = [];
		const reader = readLines(session.lines, lines);
		session.stdin.write(`${JSON.stringify({ type: "init", value: {} })}\n`);
		await reader;
		expect(lines.some((line) => line.includes('"ready"'))).toBe(true);
		local.stop(handleId);
	});

	it("stop sends SIGTERM to spawned child", () => {
		const local = createLocalTransportImpl({
			adapterCommand: ["node", "-e", "setInterval(() => {}, 1000)"],
		});
		const handleId = local.create();
		local.spawn(handleId, [], null);
		local.stop(handleId);
		const probe = spawnSync("node", ["-e", "process.exit(0)"]);
		expect(probe.status).toBe(0);
	});

	it("destroy is a no-op after stop", () => {
		const local = createLocalTransportImpl({
			adapterCommand: ["node", "-e", "process.exit(0)"],
		});
		const handleId = local.create();
		local.spawn(handleId, [], null);
		local.stop(handleId);
		expect(() => local.destroy()).not.toThrow();
	});
});

async function readLines(
	lines: AsyncIterable<string>,
	out: Array<string>,
): Promise<void> {
	for await (const line of lines) {
		out.push(line);
		if (out.some((item) => item.includes('"ready"'))) return;
	}
}
