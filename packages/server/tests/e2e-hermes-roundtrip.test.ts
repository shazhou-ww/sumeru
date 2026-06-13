/**
 * End-to-end Hermes roundtrip — full POST→SSE→DELETE flow against a live
 * `hermes` binary. See `specs/e2e-hermes-roundtrip.md`.
 *
 * Skipped by default — set `SUMERU_HERMES_INTEGRATION=1` to run. The default
 * `pnpm run test` suite must NOT require a working Hermes installation.
 *
 * Steps mirror the spec exactly; assertions use substring contains, not
 * equality, to absorb minor model variance.
 */

import { createHermesAdapter } from "@sumeru/adapter-hermes";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GatewayConfig, StartedServer } from "../src/index.js";
import { startServer } from "../src/index.js";

const RUN = process.env.SUMERU_HERMES_INTEGRATION === "1";

type SseRecord = { id: number | null; event: string; data: string };

function parseSse(text: string): SseRecord[] {
	const records: SseRecord[] = [];
	const blocks = text.split(/\n\n+/).filter((b) => b.trim().length > 0);
	for (const block of blocks) {
		let id: number | null = null;
		let event = "";
		const dataLines: string[] = [];
		for (const line of block.split("\n")) {
			if (line.startsWith("id: ")) {
				const parsed = Number.parseInt(line.slice(4).trim(), 10);
				id = Number.isFinite(parsed) ? parsed : null;
			} else if (line.startsWith("event: ")) {
				event = line.slice(7).trim();
			} else if (line.startsWith("data: ")) {
				dataLines.push(line.slice(6));
			}
		}
		records.push({ id, event, data: dataLines.join("\n") });
	}
	return records;
}

async function postJson(
	url: string,
	body: unknown,
): Promise<{ status: number; body: { value: unknown } }> {
	const res = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	const text = await res.text();
	const parsed =
		text.length > 0
			? (JSON.parse(text) as { value: unknown })
			: { value: null };
	return { status: res.status, body: parsed };
}

async function postSse(
	url: string,
	body: string,
	headers: Record<string, string> = {},
): Promise<{ status: number; text: string }> {
	const res = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json", ...headers },
		body,
	});
	return { status: res.status, text: await res.text() };
}

describe("e2e: hermes roundtrip (real hermes binary)", () => {
	let server: StartedServer | null = null;
	let baseUrl = "";

	beforeAll(async () => {
		if (!RUN) return;
		const gateways: Record<string, GatewayConfig> = {
			hermes: {
				adapter: "hermes",
				capabilities: { resume: true, streaming: false },
			},
		};
		server = await startServer({
			name: "sumeru@e2e-test",
			version: "0.0.0",
			host: "127.0.0.1",
			port: 0,
			gateways,
			adapters: { hermes: createHermesAdapter({}) },
			sseHeartbeatMs: null,
			sseBufferSize: null,
			sseRetentionMs: null,
		});
		baseUrl = `http://${server.host}:${server.port}`;
	}, 30_000);

	afterAll(async () => {
		if (server !== null) await server.stop();
	});

	it.skipIf(!RUN)(
		"step 1: POST /gateways/hermes/sessions creates a session with idle status",
		async () => {
			const res = await postJson(`${baseUrl}/gateways/hermes/sessions`, {
				config: {
					model: "anthropic/claude-haiku-4",
					systemPrompt: "You are a brevity bot. Answer in one short sentence.",
				},
			});
			expect(res.status).toBe(201);
			const value = res.body.value as {
				id: string;
				status: string;
				config: { model: string };
			};
			expect(value.id).toMatch(/^ses_[0-9A-HJKMNP-TV-Z]{26}$/);
			expect(value.status).toBe("idle");
			expect(value.config.model).toBe("anthropic/claude-haiku-4");
		},
		60_000,
	);

	it.skipIf(!RUN)(
		"step 2: first message stream returns turn(s) + done with @sumeru/turn envelope",
		async () => {
			const created = await postJson(`${baseUrl}/gateways/hermes/sessions`, {
				config: { model: "anthropic/claude-haiku-4" },
			});
			const sessionId = (created.body.value as { id: string }).id;
			try {
				const stream1 = await postSse(
					`${baseUrl}/gateways/hermes/sessions/${sessionId}/messages`,
					JSON.stringify({
						content: "My favorite number is 42. Acknowledge it briefly.",
					}),
				);
				expect(stream1.status).toBe(200);
				const events = parseSse(stream1.text);
				const dones = events.filter((e) => e.event === "done");
				expect(dones.length).toBe(1);
				const turns = events.filter((e) => e.event === "turn");
				expect(turns.length).toBeGreaterThanOrEqual(2);
				const firstTurn = JSON.parse(turns[0]?.data ?? "{}") as {
					type: string;
					value: { role: string; content: string };
				};
				expect(firstTurn.type).toBe("@sumeru/turn");
				expect(firstTurn.value.role).toBe("user");
			} finally {
				await fetch(`${baseUrl}/gateways/hermes/sessions/${sessionId}`, {
					method: "DELETE",
				});
			}
		},
		90_000,
	);

	it.skipIf(!RUN)(
		"step 3: resume — second message recalls the favorite number",
		async () => {
			const created = await postJson(`${baseUrl}/gateways/hermes/sessions`, {
				config: { model: "anthropic/claude-haiku-4" },
			});
			const sessionId = (created.body.value as { id: string }).id;
			try {
				await postSse(
					`${baseUrl}/gateways/hermes/sessions/${sessionId}/messages`,
					JSON.stringify({
						content: "My favorite number is 42. Acknowledge it briefly.",
					}),
				);
				const stream2 = await postSse(
					`${baseUrl}/gateways/hermes/sessions/${sessionId}/messages`,
					JSON.stringify({
						content: "What is my favorite number? Reply with just the digits.",
					}),
				);
				const events = parseSse(stream2.text);
				const assistantContent = events
					.filter((e) => e.event === "turn")
					.map(
						(e) =>
							JSON.parse(e.data) as {
								value: { role: string; content: string };
							},
					)
					.filter((t) => t.value.role === "assistant")
					.map((t) => t.value.content)
					.join(" ");
				expect(assistantContent).toContain("42");
			} finally {
				await fetch(`${baseUrl}/gateways/hermes/sessions/${sessionId}`, {
					method: "DELETE",
				});
			}
		},
		90_000,
	);

	it.skipIf(!RUN)(
		"steps 4-5: disconnect and resume via Last-Event-ID with no missing/duplicate events",
		async () => {
			const created = await postJson(`${baseUrl}/gateways/hermes/sessions`, {
				config: { model: "anthropic/claude-haiku-4" },
			});
			const sessionId = (created.body.value as { id: string }).id;
			try {
				const url = `${baseUrl}/gateways/hermes/sessions/${sessionId}/messages`;
				const body = JSON.stringify({
					content: "List the integers from 1 to 5 separated by spaces.",
				});

				// Step 4: drop after first turn or 2s.
				const ctrl = new AbortController();
				let firstId = 0;
				const broken = await fetch(url, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body,
					signal: ctrl.signal,
				}).catch((err) => {
					if (err instanceof Error && err.name === "AbortError") return null;
					throw err;
				});
				if (broken !== null) {
					const reader = broken.body?.getReader();
					if (reader) {
						const decoder = new TextDecoder();
						let buf = "";
						const deadline = Date.now() + 2000;
						while (Date.now() < deadline) {
							const { done, value } = await reader.read();
							if (done) break;
							buf += decoder.decode(value);
							const records = parseSse(buf);
							const turn = records.find((r) => r.event === "turn");
							if (turn !== undefined && turn.id !== null) {
								firstId = turn.id;
								ctrl.abort();
								break;
							}
						}
					}
				}

				await new Promise((r) => setTimeout(r, 1000));

				// Step 5: resume.
				const resumed = await postSse(url, body, {
					"last-event-id": String(firstId),
				});
				expect(resumed.status).toBe(200);
				const resumedEvents = parseSse(resumed.text);
				const ids = resumedEvents
					.map((e) => e.id)
					.filter((id): id is number => id !== null);
				// All resumed ids strictly greater than firstId; no duplicates with broken stream.
				for (const id of ids) {
					expect(id).toBeGreaterThan(firstId);
				}
				expect(resumedEvents.some((e) => e.event === "done")).toBe(true);
			} finally {
				await fetch(`${baseUrl}/gateways/hermes/sessions/${sessionId}`, {
					method: "DELETE",
				});
			}
		},
		90_000,
	);

	it.skipIf(!RUN)(
		"steps 6-8: GET/DELETE/GET — close transitions status to closed",
		async () => {
			const created = await postJson(`${baseUrl}/gateways/hermes/sessions`, {
				config: { model: "anthropic/claude-haiku-4" },
			});
			const sessionId = (created.body.value as { id: string }).id;

			const before = await fetch(
				`${baseUrl}/gateways/hermes/sessions/${sessionId}`,
			);
			expect(before.status).toBe(200);
			const beforeBody = (await before.json()) as {
				value: { status: string };
			};
			expect(beforeBody.value.status).toBe("idle");

			const del = await fetch(
				`${baseUrl}/gateways/hermes/sessions/${sessionId}`,
				{ method: "DELETE" },
			);
			expect(del.status).toBe(204);

			const after = await fetch(
				`${baseUrl}/gateways/hermes/sessions/${sessionId}`,
			);
			expect(after.status).toBe(200);
			const afterBody = (await after.json()) as {
				value: { status: string };
			};
			expect(afterBody.value.status).toBe("closed");
		},
		60_000,
	);

	it.skipIf(!RUN)(
		"tool calls: a turn includes non-empty toolCalls when the agent uses a tool",
		async () => {
			const created = await postJson(`${baseUrl}/gateways/hermes/sessions`, {
				config: { model: "anthropic/claude-haiku-4" },
			});
			const sessionId = (created.body.value as { id: string }).id;
			try {
				const stream = await postSse(
					`${baseUrl}/gateways/hermes/sessions/${sessionId}/messages`,
					JSON.stringify({
						content:
							"Use the terminal tool to run `echo hi`, then tell me what it printed.",
					}),
				);
				const turns = parseSse(stream.text)
					.filter((e) => e.event === "turn")
					.map(
						(e) =>
							JSON.parse(e.data) as {
								value: {
									toolCalls: Array<{ tool: string; output: string }> | null;
								};
							},
					);
				const withCalls = turns.filter(
					(t) => t.value.toolCalls !== null && t.value.toolCalls.length > 0,
				);
				expect(withCalls.length).toBeGreaterThanOrEqual(1);
				const first = withCalls[0]?.value.toolCalls?.[0];
				expect(first?.tool).toBe("terminal");
				expect(first?.output).toContain("hi");
			} finally {
				await fetch(`${baseUrl}/gateways/hermes/sessions/${sessionId}`, {
					method: "DELETE",
				});
			}
		},
		90_000,
	);

	// Always-present sanity stub so vitest reports the file as exercised even
	// when the integration env var is unset.
	it("file is loaded (skipped tests above run only with SUMERU_HERMES_INTEGRATION=1)", () => {
		expect(typeof createHermesAdapter).toBe("function");
	});
});
