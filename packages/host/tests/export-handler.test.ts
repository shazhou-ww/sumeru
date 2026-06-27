import { mkdtempSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { createGunzip } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createExportHandler } from "../src/handlers/export.js";
import type { InstanceManager } from "../src/instance-manager.js";
import type { ManagedInstance } from "../src/types.js";

describe("createExportHandler", () => {
	it("streams gzipped jsonl for an instance with history", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "sumeru-export-"));
		const instanceId = "inst_export";
		const jsonl = `${JSON.stringify({
			timestamp: "2026-06-27T00:00:00.000Z",
			type: "turn",
			value: {
				index: 0,
				role: "user",
				content: "hello",
				timestamp: "2026-06-27T00:00:00.000Z",
				toolCalls: null,
				tokens: null,
			},
		})}\n`;
		writeFileSync(join(dataDir, `${instanceId}.jsonl`), jsonl, "utf-8");

		const chunks: Buffer[] = [];
		const res = createStreamResponse(chunks);
		const handler = createExportHandler(
			createMockManager(minimalInstance(instanceId)),
			dataDir,
		);
		await handler(
			createMockRequest(),
			res,
			{ id: instanceId },
			`/instances/${instanceId}/export`,
			"",
		);

		expect(res.statusCode).toBe(200);
		expect(res.headers["content-type"]).toBe("application/gzip");
		expect(res.headers["content-disposition"]).toBe(
			`attachment; filename="${instanceId}.jsonl.gz"`,
		);

		const gunzip = createGunzip();
		const decompressed: Buffer[] = [];
		await new Promise<void>((resolve, reject) => {
			gunzip.on("data", (chunk: Buffer) => decompressed.push(chunk));
			gunzip.on("error", reject);
			gunzip.on("end", () => resolve());
			gunzip.end(Buffer.concat(chunks));
		});
		expect(Buffer.concat(decompressed).toString("utf-8")).toBe(jsonl);
	});

	it("returns 404 when instance does not exist", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "sumeru-export-"));
		const res = createJsonResponse();
		const handler = createExportHandler(createMockManager(null), dataDir);
		await handler(
			createMockRequest(),
			res,
			{ id: "inst_missing" },
			"/instances/inst_missing/export",
			"",
		);

		expect(res.statusCode).toBe(404);
		expect(res.body).toEqual({
			type: "@sumeru/error",
			value: {
				error: "instance_not_found",
				message: "Instance not found",
			},
		});
	});

	it("returns 404 when instance has no history file", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "sumeru-export-"));
		const instanceId = "inst_empty";
		const res = createJsonResponse();
		const handler = createExportHandler(
			createMockManager(minimalInstance(instanceId)),
			dataDir,
		);
		await handler(
			createMockRequest(),
			res,
			{ id: instanceId },
			`/instances/${instanceId}/export`,
			"",
		);

		expect(res.statusCode).toBe(404);
		expect(res.body).toEqual({
			type: "@sumeru/error",
			value: {
				error: "no_history",
				message: "No history for instance",
			},
		});
	});

	it("returns 404 when history file is empty", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "sumeru-export-"));
		const instanceId = "inst_blank";
		writeFileSync(join(dataDir, `${instanceId}.jsonl`), "", "utf-8");

		const res = createJsonResponse();
		const handler = createExportHandler(
			createMockManager(minimalInstance(instanceId)),
			dataDir,
		);
		await handler(
			createMockRequest(),
			res,
			{ id: instanceId },
			`/instances/${instanceId}/export`,
			"",
		);

		expect(res.statusCode).toBe(404);
		expect(res.body).toEqual({
			type: "@sumeru/error",
			value: {
				error: "no_history",
				message: "No history for instance",
			},
		});
	});
});

function minimalInstance(id: string): ManagedInstance {
	return {
		id,
		prototype: "claude-code",
		status: "running",
		createdAt: "2026-06-27T00:00:00.000Z",
		projects: [],
		containerId: "container-1",
		projectName: "proj",
		composePath: "/compose.yaml",
		initVersion: null,
	};
}

function createMockManager(instance: ManagedInstance | null): InstanceManager {
	return {
		getInstance: () => instance,
	} as InstanceManager;
}

function createMockRequest(): IncomingMessage {
	return {} as IncomingMessage;
}

function createJsonResponse(): ServerResponse & {
	body: unknown;
	statusCode: number;
	headers: Record<string, string>;
} {
	const res = {
		statusCode: 200,
		body: null as unknown,
		headers: {} as Record<string, string>,
		setHeader(name: string, value: string) {
			res.headers[name.toLowerCase()] = value;
			return res;
		},
		end(payload?: string) {
			if (payload !== undefined) {
				res.body = JSON.parse(payload);
			}
		},
	} as ServerResponse & {
		body: unknown;
		statusCode: number;
		headers: Record<string, string>;
	};
	return res;
}

function createStreamResponse(chunks: Buffer[]): ServerResponse & {
	statusCode: number;
	headers: Record<string, string>;
} {
	const res = Object.assign(
		new Writable({
			write(chunk, _encoding, callback) {
				chunks.push(
					typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk),
				);
				callback();
			},
		}),
		{
			statusCode: 200,
			headers: {} as Record<string, string>,
			setHeader(name: string, value: string) {
				res.headers[name.toLowerCase()] = value;
				return res;
			},
			get headersSent() {
				return true;
			},
		},
	) as ServerResponse & {
		statusCode: number;
		headers: Record<string, string>;
	};
	return res;
}
