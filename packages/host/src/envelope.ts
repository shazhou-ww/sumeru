import type { Prototype, SessionInfo } from "@sumeru/core";
import type {
	Envelope,
	ErrorValue,
	HostRootValue,
	InboxAcceptedValue,
	PrototypeInfo,
	SkillValue,
} from "./types.js";

export function envelope<T>(type: string, value: T): Envelope<T> {
	return { type, value };
}

export function hostEnvelope(value: HostRootValue): Envelope<HostRootValue> {
	return envelope("@sumeru/host", value);
}

export function prototypeListEnvelope(
	prototypes: Array<PrototypeInfo>,
): Envelope<Array<{ name: string }>> {
	return envelope(
		"@sumeru/prototype-list",
		prototypes.map((item) => ({ name: item.name })),
	);
}

export function prototypeEnvelope(info: PrototypeInfo): Envelope<Prototype> {
	return envelope("@sumeru/prototype", info.prototype);
}

export function skillEnvelope(value: SkillValue): Envelope<SkillValue> {
	return envelope("@sumeru/skill", value);
}

export function sessionListEnvelope(
	sessions: Array<SessionInfo>,
): Envelope<Array<SessionInfo>> {
	return envelope("@sumeru/session-list", sessions);
}

export function sessionEnvelope(info: SessionInfo): Envelope<SessionInfo> {
	return envelope("@sumeru/session", info);
}

export function inboxAcceptedEnvelope(
	value: InboxAcceptedValue,
): Envelope<InboxAcceptedValue> {
	return envelope("@sumeru/inbox-accepted", value);
}

export function errorEnvelope(
	error: string,
	message: string,
): Envelope<ErrorValue> {
	return envelope("@sumeru/error", { error, message });
}
