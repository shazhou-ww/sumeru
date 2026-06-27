import { appendFileSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { InstanceId, OutboxFrame, TurnValue } from "@sumeru/core";

export type RecordedEvent = {
	timestamp: string;
	type: OutboxFrame["type"];
	value: OutboxFrame["value"];
};

export type TurnRecord = RecordedEvent & {
	type: "turn";
	value: TurnValue;
	hash: string | null;
};

export type OcasRecorder = {
	record(instanceId: InstanceId, event: OutboxFrame): void;
	getTurns(
		instanceId: InstanceId,
		limit: number,
		offset: number,
	): Array<TurnRecord>;
	getTurnTotal(instanceId: InstanceId): number;
	clear(instanceId: InstanceId): void;
};

export function createOcasRecorder(dataDir: string): OcasRecorder {
	mkdirSync(dataDir, { recursive: true });

	function filePath(instanceId: InstanceId): string {
		return join(dataDir, `${instanceId}.jsonl`);
	}

	function appendLine(instanceId: InstanceId, line: RecordedEvent): void {
		appendFileSync(filePath(instanceId), `${JSON.stringify(line)}\n`, "utf-8");
	}

	function readEvents(instanceId: InstanceId): Array<RecordedEvent> {
		let raw = "";
		try {
			raw = readFileSync(filePath(instanceId), "utf-8");
		} catch {
			return [];
		}
		const events: Array<RecordedEvent> = [];
		for (const line of raw.split("\n")) {
			const trimmed = line.trim();
			if (trimmed.length === 0) continue;
			let parsed: unknown;
			try {
				parsed = JSON.parse(trimmed);
			} catch {
				continue;
			}
			const event = parseRecordedEvent(parsed);
			if (event !== null) {
				events.push(event);
			}
		}
		return events;
	}

	function record(instanceId: InstanceId, event: OutboxFrame): void {
		appendLine(instanceId, {
			timestamp: new Date().toISOString(),
			type: event.type,
			value: event.value,
		});
	}

	function getTurnTotal(instanceId: InstanceId): number {
		return readEvents(instanceId).filter((event) => event.type === "turn")
			.length;
	}

	function clear(instanceId: InstanceId): void {
		try {
			unlinkSync(filePath(instanceId));
		} catch {
			// file may not exist yet
		}
	}

	function getTurns(
		instanceId: InstanceId,
		limit: number,
		offset: number,
	): Array<TurnRecord> {
		const turns = readEvents(instanceId).filter(
			(event): event is RecordedEvent & { type: "turn"; value: TurnValue } =>
				event.type === "turn",
		);
		return turns.slice(offset, offset + limit).map(toTurnRecord);
	}

	return {
		record,
		getTurns,
		getTurnTotal,
		clear,
	};
}

function toTurnRecord(
	event: RecordedEvent & { type: "turn"; value: TurnValue },
): TurnRecord {
	return {
		timestamp: event.timestamp,
		type: "turn",
		value: event.value,
		hash: null,
	};
}

function parseRecordedEvent(value: unknown): RecordedEvent | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		return null;
	}
	const obj = value as Record<string, unknown>;
	const timestamp = obj.timestamp;
	const type = obj.type;
	const eventValue = obj.value;
	if (typeof timestamp !== "string" || timestamp.length === 0) return null;
	if (
		type !== "turn" &&
		type !== "done" &&
		type !== "suspend" &&
		type !== "error"
	) {
		return null;
	}
	if (
		eventValue === null ||
		typeof eventValue !== "object" ||
		Array.isArray(eventValue)
	) {
		return null;
	}
	return {
		timestamp,
		type,
		value: eventValue as OutboxFrame["value"],
	};
}
