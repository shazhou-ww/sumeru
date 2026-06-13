import type { Envelope, ErrorValue, Instance } from "./types.js";

/** Wrap a value in the ocas envelope shape. */
export function envelope<T>(type: string, value: T): Envelope<T> {
	return { type, value };
}

/** Build the `@sumeru/instance` envelope for `GET /`. */
export function instanceEnvelope(instance: Instance): Envelope<Instance> {
	return envelope("@sumeru/instance", instance);
}

/** Build a `@sumeru/error` envelope for non-2xx responses. */
export function errorEnvelope(
	error: string,
	message: string,
): Envelope<ErrorValue> {
	return envelope("@sumeru/error", { error, message });
}
