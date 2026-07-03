import { mkdtempSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { createGunzip } from "node:zlib";
import { describe, expect, it } from "vitest";
import { createExportHandler } from "../src/handlers/export.js";
import { createOcasRecorder } from "../src/ocas-recorder.js";
import type { SessionManager } from "../src/session-manager.js";
import type { ManagedSession } from "../src/types.js";

const HASH_RE = /^[0-9A-HJKMNP-TV-Z]{13}$/;

describe("createExportHandler", () => {
	it("streams gzipped ndjson from CAS chain", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "sumeru-export-"));
		const sessionId = "ses_export";

		const recorder = createOcasRecorder(dataDir);
		recorder.append(sessionId, {
			type: "turn",
			value: {
				index: 0,
				role: "user",
				content: "hello",
				timestamp: "2026-06-27T00:00:00.000Z",
				toolCalls: null,
				tokens: null,
			},
		});
		recorder.append(sessionId, {
			type: "done",
			value: { summary: "ok", tokenUsage: null },
		});

		const chunks: Buffer[] = [];
		const res = createStreamResponse(chunks);
		const handler = createExportHandler(
			createMockManager(minimalSession(sessionId)),
			dataDir,
		);
		await handler(
			createMockRequest(),
			res,
			{ id: sessionId },
			`/sessions/${sessionId}/export`,
			"",
		);

		expect(res.statusCode).toBe(200);
		expect(res.headers["content-type"]).toBe("application/gzip");
		expect(res.headers["content-disposition"]).toBe(
			`attachment; filename="${sessionId}.ndjson.gz"`,
		);

		const decompressed = await gunzipBuffer(Buffer.concat(chunks));
		const lines = decompressed
			.toString("utf-8")
			.split("\n")
			.filter((l) => l.length > 0);
		expect(lines).toHaveLength(2);

		const first = JSON.parse(lines[0] as string);
		expect(first.hash).toMatch(HASH_RE);
		expect(first.prev).toBeNull();
		expect(first.type).toBe("turn");
		expect(first.value.content).toBe("hello");

		const second = JSON.parse(lines[1] as string);
		expect(second.hash).toMatch(HASH_RE);
		expect(second.prev).toBe(first.hash);
		expect(second.type).toBe("done");
	});

	it("returns 404 when session does not exist", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "sumeru-export-"));
		const res = createJsonResponse();
		const handler = createExportHandler(createMockManager(null), dataDir);
		await handler(
			createMockRequest(),
			res,
			{ id: "ses_missing" },
			"/sessions/ses_missing/export",
			"",
		);

		expect(res.statusCode).toBe(404);
		expect(res.body).toEqual({
			type: "@sumeru/error",
			value: {
				error: "session_not_found",
				message: "Session not found",
			},
		});
	});

	it("returns 404 when session has no chain history", async () => {
		const dataDir = mkdtempSync(join(tmpdir(), "sumeru-export-"));
		const sessionId = "ses_empty";
		const res = createJsonResponse();
		const handler = createExportHandler(
			createMockManager(minimalSession(sessionId)),
			dataDir,
		);
		await handler(
			createMockRequest(),
			res,
			{ id: sessionId },
			`/sessions/${sessionId}/export`,
			"",
		);

		expect(res.statusCode).toBe(404);
		expect(res.body).toEqual({
			type: "@sumeru/error",
			value: {
				error: "no_history",
				message: "No history for session",
			},
		});
	});
});

function gunzipBuffer(buf: Buffer): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		const gunzip = createGunzip();
		const chunks: Buffer[] = [];
		gunzip.on("data", (chunk: Buffer) => chunks.push(chunk));
		gunzip.on("error", reject);
		gunzip.on("end", () => resolve(Buffer.concat(chunks)));
		gunzip.end(buf);
	});
}

function minimalSession(id: string): ManagedSession {
	return {
		id,
		prototype: "claude-code",
		model: {
			provider: "anthropic",
			name: "claude-sonnet-4",
			apiKey: "sk-test",
		},
		image: "example",
		project: "demo",
		task: "hello",
		status: "running",
		exit: null,
		createdAt: "2026-06-27T00:00:00.000Z",
		containerId: "container-1",
		projectName: "proj",
		composePath: "/compose.yaml",
		imageTag: null,
		initVersion: null,
		projectPath: "/tmp/workspaces/demo",
		sessionEnv: {},
	};
}

function createMockManager(session: ManagedSession | null): SessionManager {
	return {
		getSession: () => session,
	} as SessionManager;
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
