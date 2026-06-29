import type { ServerResponse } from "node:http";

export function writeJson(
	res: ServerResponse,
	status: number,
	body: unknown,
): void {
	const payload = JSON.stringify(body);
	res.statusCode = status;
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Content-Length", Buffer.byteLength(payload).toString());
	res.end(payload);
}

export async function readTextBody(
	req: import("node:http").IncomingMessage,
): Promise<string> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
	}
	return Buffer.concat(chunks).toString("utf-8");
}

export async function readJsonBody(
	req: import("node:http").IncomingMessage,
): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
	}
	const raw = Buffer.concat(chunks).toString("utf-8").trim();
	if (raw.length === 0) return {};
	try {
		return JSON.parse(raw);
	} catch {
		throw new Error("invalid_json");
	}
}

export function writeSseHeaders(res: ServerResponse): void {
	res.statusCode = 200;
	res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
	res.setHeader("Cache-Control", "no-cache, no-transform");
	res.setHeader("Connection", "keep-alive");
	res.setHeader("X-Accel-Buffering", "no");
	res.socket?.setNoDelay(true);
	res.flushHeaders?.();
}

export function writeSseEvent(
	res: ServerResponse,
	event: string,
	data: unknown,
): void {
	const payload = JSON.stringify(data);
	res.write(`event: ${event}\n`);
	res.write(`data: ${payload}\n\n`);
}

export function writeRawSseEvent(
	res: ServerResponse,
	evt: { id: number; event: string; data: string },
): void {
	res.write(`id: ${evt.id}\n`);
	res.write(`event: ${evt.event}\n`);
	res.write(`data: ${evt.data}\n\n`);
}
