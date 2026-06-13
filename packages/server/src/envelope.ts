import type {
	Envelope,
	ErrorValue,
	Gateway,
	Instance,
	Session,
	SessionListEntry,
} from "./types.js";

/** Wrap a value in the ocas envelope shape. */
export function envelope<T>(type: string, value: T): Envelope<T> {
	return { type, value };
}

/** Build the `@sumeru/instance` envelope for `GET /`. */
export function instanceEnvelope(instance: Instance): Envelope<Instance> {
	return envelope("@sumeru/instance", instance);
}

/** Build the `@sumeru/gateway-list` envelope for `GET /gateways`. */
export function gatewayListEnvelope(gateways: Gateway[]): Envelope<Gateway[]> {
	return envelope("@sumeru/gateway-list", gateways);
}

/** Build the `@sumeru/gateway` envelope for `GET /gateways/:name`. */
export function gatewayEnvelope(gateway: Gateway): Envelope<Gateway> {
	return envelope("@sumeru/gateway", gateway);
}

/**
 * Build the `@sumeru/session` envelope for
 * `POST /gateways/:name/sessions` (201) and
 * `GET  /gateways/:name/sessions/:id` (200).
 */
export function sessionEnvelope(session: Session): Envelope<Session> {
	return envelope("@sumeru/session", session);
}

/**
 * Build the `@sumeru/session-list` envelope for `GET /gateways/:name/sessions`.
 * List entries omit `config` to keep listings compact.
 */
export function sessionListEnvelope(
	sessions: SessionListEntry[],
): Envelope<SessionListEntry[]> {
	return envelope("@sumeru/session-list", sessions);
}

/** Build a `@sumeru/error` envelope for non-2xx responses. */
export function errorEnvelope(
	error: string,
	message: string,
): Envelope<ErrorValue> {
	return envelope("@sumeru/error", { error, message });
}
