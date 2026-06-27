export type SseEvent = {
	id: number;
	event: string;
	data: string;
};

export type SseBufferAppendInput = {
	event: string;
	data: string;
};

export type SseBuffer = {
	append(input: SseBufferAppendInput): SseEvent;
	eventsAfter(lastId: number): Array<SseEvent>;
	latest(): number;
	isExpired(lastEventId: number): boolean;
};

export function createSseBuffer(maxSize = 1024): SseBuffer {
	const slots: Array<SseEvent | null> = new Array(maxSize).fill(null);
	let start = 0;
	let count = 0;
	let nextId = 1;

	function oldestId(): number {
		if (count === 0) return 0;
		return slots[start]?.id ?? 0;
	}

	function append(input: SseBufferAppendInput): SseEvent {
		const entry: SseEvent = {
			id: nextId,
			event: input.event,
			data: input.data,
		};
		nextId += 1;
		if (count < maxSize) {
			slots[(start + count) % maxSize] = entry;
			count += 1;
		} else {
			slots[start] = entry;
			start = (start + 1) % maxSize;
		}
		return entry;
	}

	function eventsAfter(lastId: number): Array<SseEvent> {
		const result: Array<SseEvent> = [];
		for (let i = 0; i < count; i += 1) {
			const slot = slots[(start + i) % maxSize];
			if (slot !== null && slot.id > lastId) {
				result.push(slot);
			}
		}
		return result;
	}

	function latest(): number {
		if (count === 0) return 0;
		const slot = slots[(start + count - 1) % maxSize];
		return slot?.id ?? 0;
	}

	function isExpired(lastEventId: number): boolean {
		if (count === 0 || lastEventId === 0) return false;
		return lastEventId < oldestId();
	}

	return { append, eventsAfter, latest, isExpired };
}
