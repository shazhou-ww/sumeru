import type { Prototype, SessionInfo, Turn, Image } from "@sumeru/core";
import type {
	Envelope,
	ErrorValue,
	HostRootValue,
	InboxAcceptedValue,
	MessageAcceptedValue,
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

export function turnListEnvelope(turns: Array<Turn>): Envelope<Array<Turn>> {
	return envelope("@sumeru/turn-list", turns);
}

export function imageListEnvelope(images: Array<Image>): Envelope<Array<Image>> {
	return envelope("@sumeru/image-list", images);
}

export function imageEnvelope(image: Image): Envelope<Image> {
	return envelope("@sumeru/image", image);
}

export function messageAcceptedEnvelope(
	value: MessageAcceptedValue,
): Envelope<MessageAcceptedValue> {
	return envelope("@sumeru/message-accepted", value);
}

/** @deprecated Use messageAcceptedEnvelope */
export function inboxAcceptedEnvelope(
	value: InboxAcceptedValue,
): Envelope<InboxAcceptedValue> {
	return messageAcceptedEnvelope(value);
}

export function errorEnvelope(
	error: string,
	message: string,
): Envelope<ErrorValue> {
	return envelope("@sumeru/error", { error, message });
}
