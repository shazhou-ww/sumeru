/**
 * SSE encoding layer.
 *
 * Consumes an `AsyncIterable<SseOutEvent>`, assigns sequential IDs via the
 * buffer, and writes wire-formatted SSE frames to the HTTP response.
 */

import type { ServerResponse } from "node:http";
import type { SseOutEvent } from "./action.js";
import { appendEvent, formatEvent, type SseBuffer } from "./buffer.js";

/**
 * Write SSE response headers. After this call the connection is committed to
 * the text/event-stream content type — no JSON error response is possible.
 */
export function writeSseHeaders(res: ServerResponse): void {
	res.statusCode = 200;
	res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
	res.setHeader("Cache-Control", "no-cache, no-transform");
	res.setHeader("Connection", "keep-alive");
	res.setHeader("X-Accel-Buffering", "no");
	res.socket?.setNoDelay(true);
	res.flushHeaders?.();
}

/**
 * Consume `source` events, buffer each one (assigning a sequential ID), and
 * write the formatted SSE frame to `res`. Returns when the source is
 * exhausted.
 */
export async function writeSseStream(
	res: ServerResponse,
	source: AsyncIterable<SseOutEvent>,
	buf: SseBuffer,
): Promise<void> {
	for await (const out of source) {
		const evt = appendEvent(buf, out.event, out.data);
		res.write(formatEvent(evt));
	}
}
