import type { BuiltinModel } from "@sumeru/adapter-core";
import type {
	Extension,
	Model,
	Persona,
	Prototype,
	Provider,
	SessionInfo,
	Turn,
} from "@sumeru/core";
import type {
	AdapterInfo,
	CommandAcceptedValue,
	CommandResultValue,
	Envelope,
	ErrorValue,
	HostRootValue,
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
): Envelope<Array<Prototype>> {
	return envelope(
		"@sumeru/prototype-list",
		prototypes.map((item) => item.prototype),
	);
}

export function prototypeEnvelope(info: PrototypeInfo): Envelope<Prototype> {
	return envelope("@sumeru/prototype", info.prototype);
}

export function extensionListEnvelope(
	extensions: Array<Extension>,
): Envelope<Array<Extension>> {
	return envelope("@sumeru/extension-list", extensions);
}

export function extensionEnvelope(extension: Extension): Envelope<Extension> {
	return envelope("@sumeru/extension", extension);
}

export function providerListEnvelope(
	providers: Array<Provider>,
): Envelope<Array<Provider>> {
	return envelope("@sumeru/provider-list", providers);
}

export function providerEnvelope(provider: Provider): Envelope<Provider> {
	return envelope("@sumeru/provider", provider);
}

export function adapterListEnvelope(
	adapters: Array<AdapterInfo>,
): Envelope<Array<AdapterInfo>> {
	return envelope("@sumeru/adapter-list", adapters);
}

export function adapterEnvelope(adapter: AdapterInfo): Envelope<AdapterInfo> {
	return envelope("@sumeru/adapter", adapter);
}

export function adapterModelListEnvelope(
	models: Array<BuiltinModel>,
): Envelope<Array<BuiltinModel>> {
	return envelope("@sumeru/adapter-model-list", models);
}

export function modelListEnvelope(
	models: Array<Model>,
): Envelope<Array<Model>> {
	return envelope("@sumeru/model-list", models);
}

export function modelEnvelope(model: Model): Envelope<Model> {
	return envelope("@sumeru/model", model);
}

export function personaListEnvelope(
	personas: Array<Persona>,
): Envelope<Array<Persona>> {
	return envelope("@sumeru/persona-list", personas);
}

export function personaEnvelope(persona: Persona): Envelope<Persona> {
	return envelope("@sumeru/persona", persona);
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

export function messageAcceptedEnvelope(
	value: MessageAcceptedValue,
): Envelope<MessageAcceptedValue> {
	return envelope("@sumeru/message-accepted", value);
}

export function commandAcceptedEnvelope(
	value: CommandAcceptedValue,
): Envelope<CommandAcceptedValue> {
	return envelope("@sumeru/command-accepted", value);
}

export function commandResultEnvelope(
	value: CommandResultValue,
): Envelope<CommandResultValue> {
	return envelope("@sumeru/command-result", value);
}

export function errorEnvelope(
	error: string,
	message: string,
): Envelope<ErrorValue> {
	return envelope("@sumeru/error", { error, message });
}
