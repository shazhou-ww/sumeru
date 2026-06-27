import type { InstanceInfo, Manifest } from "@sumeru/core";
import type {
	Envelope,
	ErrorValue,
	HostRootValue,
	InboxAcceptedValue,
	InstanceStatusValue,
	PrototypeInfo,
} from "./types.js";

export function envelope<T>(type: string, value: T): Envelope<T> {
	return { type, value };
}

export function hostEnvelope(value: HostRootValue): Envelope<HostRootValue> {
	return envelope("@sumeru/host", value);
}

export function prototypeListEnvelope(
	prototypes: Array<PrototypeInfo>,
): Envelope<Array<{ name: string; adapter: string }>> {
	return envelope(
		"@sumeru/prototype-list",
		prototypes.map((item) => ({ name: item.name, adapter: item.adapter })),
	);
}

export function prototypeEnvelope(
	info: PrototypeInfo,
): Envelope<{ name: string; adapter: string; manifest: Manifest }> {
	return envelope("@sumeru/prototype", {
		name: info.name,
		adapter: info.adapter,
		manifest: info.manifest,
	});
}

export function instanceListEnvelope(
	instances: Array<InstanceInfo>,
): Envelope<Array<InstanceInfo>> {
	return envelope("@sumeru/instance-list", instances);
}

export function instanceEnvelope(info: InstanceInfo): Envelope<InstanceInfo> {
	return envelope("@sumeru/instance", info);
}

export function instanceStatusEnvelope(
	value: InstanceStatusValue,
): Envelope<InstanceStatusValue> {
	return envelope("@sumeru/instance-status", value);
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
