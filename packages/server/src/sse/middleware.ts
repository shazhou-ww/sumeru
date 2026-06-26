/**
 * SSE middleware layer.
 *
 * Provides composable transforms over `AsyncIterable<SseOutEvent>`. Each
 * middleware conforms to `ApiMiddleware<SseOutEvent, TCtx>` — it takes a source
 * iterable and a context object, returning a new iterable that wraps the source.
 */

import type { SseOutEvent } from "./action.js";

export type HeartbeatCtx = {
	intervalMs: number;
	startedAt: number;
};

/**
 * Merge periodic heartbeat events into the source stream. A heartbeat is
 * emitted every `intervalMs` while waiting for the next source event. The
 * timer is cleaned up when the source terminates.
 *
 * Signature satisfies `ApiMiddleware<SseOutEvent, HeartbeatCtx>`.
 */
export async function* withHeartbeats(
	source: AsyncIterable<SseOutEvent>,
	ctx: HeartbeatCtx,
): AsyncGenerator<SseOutEvent> {
	const iter = source[Symbol.asyncIterator]();
	let timer: NodeJS.Timeout | null = null;
	let pendingNext: Promise<IteratorResult<SseOutEvent, undefined>> | null =
		null;

	function scheduleTimer(): Promise<void> {
		return new Promise<void>((resolve) => {
			timer = setTimeout(
				() => {
					resolve();
				},
				Math.max(50, ctx.intervalMs),
			);
			(timer as NodeJS.Timeout).unref();
		});
	}

	try {
		let hbPromise = scheduleTimer();

		while (true) {
			if (pendingNext === null) {
				pendingNext = iter.next() as Promise<
					IteratorResult<SseOutEvent, undefined>
				>;
			}

			const winner = await Promise.race([
				pendingNext.then((r) => ({ src: true as const, r })),
				hbPromise.then(() => ({ src: false as const, r: undefined })),
			]);

			if (!winner.src) {
				yield {
					event: "heartbeat",
					data: JSON.stringify({
						type: "@sumeru/heartbeat",
						value: { elapsed: Date.now() - ctx.startedAt },
					}),
				};
				hbPromise = scheduleTimer();
			} else {
				pendingNext = null;
				const result = winner.r as IteratorResult<SseOutEvent, undefined>;
				if (result.done) break;
				yield result.value;
			}
		}
	} finally {
		if (timer !== null) clearTimeout(timer);
	}
}
