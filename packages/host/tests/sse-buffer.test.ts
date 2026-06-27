import { describe, expect, it } from "vitest";
import { createSseBuffer } from "../src/sse-buffer.js";

describe("createSseBuffer", () => {
	it("assigns auto-incrementing ids on append", () => {
		const buffer = createSseBuffer();
		const first = buffer.append({ event: "turn", data: '{"type":"turn"}' });
		const second = buffer.append({ event: "done", data: '{"type":"done"}' });
		expect(first.id).toBe(1);
		expect(second.id).toBe(2);
		expect(buffer.latest()).toBe(2);
	});

	it("returns events after a given id in order", () => {
		const buffer = createSseBuffer();
		buffer.append({ event: "turn", data: "1" });
		buffer.append({ event: "turn", data: "2" });
		buffer.append({ event: "done", data: "3" });
		expect(buffer.eventsAfter(0)).toHaveLength(3);
		expect(buffer.eventsAfter(1)).toHaveLength(2);
		expect(buffer.eventsAfter(1).map((evt) => evt.data)).toEqual(["2", "3"]);
		expect(buffer.eventsAfter(3)).toEqual([]);
	});

	it("evicts oldest events when maxSize is exceeded", () => {
		const buffer = createSseBuffer(3);
		buffer.append({ event: "turn", data: "1" });
		buffer.append({ event: "turn", data: "2" });
		buffer.append({ event: "turn", data: "3" });
		buffer.append({ event: "done", data: "4" });
		expect(buffer.eventsAfter(0).map((evt) => evt.data)).toEqual([
			"2",
			"3",
			"4",
		]);
		expect(buffer.isExpired(1)).toBe(true);
		expect(buffer.isExpired(2)).toBe(false);
	});

	it("treats empty buffer as never expired", () => {
		const buffer = createSseBuffer();
		expect(buffer.isExpired(99)).toBe(false);
		expect(buffer.latest()).toBe(0);
	});
});
