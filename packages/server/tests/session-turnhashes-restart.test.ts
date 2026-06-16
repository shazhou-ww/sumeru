/**
 * Phase 6 — `server-session-turnhashes-persistence.md` process-level restart
 * semantics (Refs #399).
 *
 * Boots a server against a tmp `--ocas-dir`, records turns, captures history,
 * stops the process, boots a NEW server against the SAME dir, and asserts the
 * turn history survives byte-for-byte in order. Pre-fix the post-restart total
 * is 0; post-fix it equals the pre-restart total.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type GatewayConfig,
	type StartedServer,
	startServer,
} from "../src/index.js";
import { makeStubAdapter } from "./fixtures/stub-adapter.js";

const HASH_RE = /^[0-9A-HJKMNP-TV-Z]{13}$/;

const HERMES_GATEWAY: Record<string, GatewayConfig> = {
	hermes: {
		adapter: "hermes",
		capabilities: { resume: true, streaming: false },
		config: null,
	},
};

function tmpOcasDir(): string {
	return mkdtempSync(join(tmpdir(), "sumeru-ocas-"));
}

function bootServer(ocasDir: string): Promise<StartedServer> {
	const stub = makeStubAdapter({ name: "hermes" });
	return startServer({
		port: 0,
		host: "127.0.0.1",
		name: "test",
		version: "0.0.0",
		gateways: HERMES_GATEWAY,
		workspaceRoot: null,
		adapters: { hermes: stub.adapter },
		sseHeartbeatMs: null,
		sseBufferSize: null,
		sseRetentionMs: null,
		ocasDir,
	});
}

async function createSession(baseUrl: string): Promise<string> {
	const res = await fetch(`${baseUrl}/gateways/hermes/sessions`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	});
	const body = (await res.json()) as { value: { id: string } };
	return body.value.id;
}

async function sendMessage(
	baseUrl: string,
	sessionId: string,
	content: string,
): Promise<void> {
	const res = await fetch(
		`${baseUrl}/gateways/hermes/sessions/${sessionId}/messages`,
		{
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "text/event-stream",
			},
			body: JSON.stringify({ content }),
		},
	);
	await res.text();
}

type HistoryBody = {
	value: {
		total: number;
		turns: Array<{ hash: string; role: string; content: string }>;
	};
};

async function getHistory(
	baseUrl: string,
	sessionId: string,
): Promise<HistoryBody["value"]> {
	const res = await fetch(
		`${baseUrl}/gateways/hermes/sessions/${sessionId}/messages`,
	);
	const body = (await res.json()) as HistoryBody;
	return body.value;
}

describe("session turnHashes — process-level restart semantics", () => {
	let servers: StartedServer[] = [];

	afterEach(async () => {
		for (const s of servers) {
			await s.stop();
		}
		servers = [];
	});

	it("turn history survives a server restart (same total, same hashes, same order)", async () => {
		const dir = tmpOcasDir();

		const first = await bootServer(dir);
		servers.push(first);
		const baseA = `http://${first.host}:${first.port}`;

		const sessionId = await createSession(baseA);
		await sendMessage(baseA, sessionId, "hello");

		const before = await getHistory(baseA, sessionId);
		expect(before.total).toBe(2);
		const beforeHashes = before.turns.map((t) => t.hash);
		expect(beforeHashes[0]).toMatch(HASH_RE);

		await first.stop();
		servers = servers.filter((s) => s !== first);

		// Boot a NEW process against the SAME dir.
		const second = await bootServer(dir);
		servers.push(second);
		const baseB = `http://${second.host}:${second.port}`;

		const after = await getHistory(baseB, sessionId);
		expect(after.total).toBe(before.total);
		expect(after.turns.map((t) => t.hash)).toEqual(beforeHashes);
		// Bodies round-trip byte-identical (fetched from the immutable node).
		expect(
			after.turns.map((t) => ({ role: t.role, content: t.content })),
		).toEqual(before.turns.map((t) => ({ role: t.role, content: t.content })));
	});

	it("restored session is visible in detail + list endpoints with status preserved", async () => {
		const dir = tmpOcasDir();
		const first = await bootServer(dir);
		servers.push(first);
		const baseA = `http://${first.host}:${first.port}`;
		const sessionId = await createSession(baseA);
		await sendMessage(baseA, sessionId, "ping");
		await first.stop();
		servers = servers.filter((s) => s !== first);

		const second = await bootServer(dir);
		servers.push(second);
		const baseB = `http://${second.host}:${second.port}`;

		const detail = await fetch(
			`${baseB}/gateways/hermes/sessions/${sessionId}`,
		);
		expect(detail.status).toBe(200);
		const detailBody = (await detail.json()) as {
			value: { id: string; status: string };
		};
		expect(detailBody.value.id).toBe(sessionId);
		expect(detailBody.value.status).toBe("idle");

		const list = await fetch(`${baseB}/gateways/hermes/sessions`);
		const listBody = (await list.json()) as {
			value: Array<{ id: string }>;
		};
		expect(listBody.value.map((s) => s.id)).toContain(sessionId);
	});

	it("POST to a restored session returns 503 (nativeRef not rehydrated — documented non-goal)", async () => {
		const dir = tmpOcasDir();
		const first = await bootServer(dir);
		servers.push(first);
		const baseA = `http://${first.host}:${first.port}`;
		const sessionId = await createSession(baseA);
		await sendMessage(baseA, sessionId, "first");
		await first.stop();
		servers = servers.filter((s) => s !== first);

		const second = await bootServer(dir);
		servers.push(second);
		const baseB = `http://${second.host}:${second.port}`;

		const res = await fetch(
			`${baseB}/gateways/hermes/sessions/${sessionId}/messages`,
			{
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "text/event-stream",
				},
				body: JSON.stringify({ content: "second" }),
			},
		);
		expect(res.status).toBe(503);
		const body = (await res.json()) as { value: { error: string } };
		expect(body.value.error).toBe("adapter_unavailable");
	});

	it("restarting twice with no new turns keeps total stable (no duplication)", async () => {
		const dir = tmpOcasDir();
		const first = await bootServer(dir);
		servers.push(first);
		const baseA = `http://${first.host}:${first.port}`;
		const sessionId = await createSession(baseA);
		await sendMessage(baseA, sessionId, "hello");
		const before = await getHistory(baseA, sessionId);
		await first.stop();
		servers = servers.filter((s) => s !== first);

		const second = await bootServer(dir);
		servers.push(second);
		const total2 = (
			await getHistory(`http://${second.host}:${second.port}`, sessionId)
		).total;
		await second.stop();
		servers = servers.filter((s) => s !== second);

		const third = await bootServer(dir);
		servers.push(third);
		const total3 = (
			await getHistory(`http://${third.host}:${third.port}`, sessionId)
		).total;

		expect(total2).toBe(before.total);
		expect(total3).toBe(before.total);
	});

	it("empty session (no turns) survives restart with total 0", async () => {
		const dir = tmpOcasDir();
		const first = await bootServer(dir);
		servers.push(first);
		const baseA = `http://${first.host}:${first.port}`;
		const sessionId = await createSession(baseA);
		await first.stop();
		servers = servers.filter((s) => s !== first);

		const second = await bootServer(dir);
		servers.push(second);
		const baseB = `http://${second.host}:${second.port}`;

		const detail = await fetch(
			`${baseB}/gateways/hermes/sessions/${sessionId}`,
		);
		expect(detail.status).toBe(200);
		const after = await getHistory(baseB, sessionId);
		expect(after.total).toBe(0);
		expect(after.turns).toEqual([]);
	});
});
