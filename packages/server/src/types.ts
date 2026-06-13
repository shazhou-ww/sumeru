/**
 * @sumeru/server — HTTP service for the Sumeru observation lab.
 *
 * Phase 0: instance endpoint + envelope error shape.
 * All responses follow the ocas envelope: { type, value }.
 */

// ─── Envelope ────────────────────────────────────────────

/** Generic ocas-style envelope. Every HTTP response body uses this shape. */
export type Envelope<T> = {
	type: string;
	value: T;
};

// ─── Instance ────────────────────────────────────────────

/** The instance value returned by `GET /`. */
export type Instance = {
	name: string;
	version: string;
	gateways: Gateway[];
};

/** A registered gateway (none in Phase 0). */
export type Gateway = {
	name: string;
};

// ─── Errors ──────────────────────────────────────────────

/** Error body shape, wrapped in `{ type: "@sumeru/error", value }`. */
export type ErrorValue = {
	error: string;
	message: string;
};

// ─── Server ──────────────────────────────────────────────

/** Configuration for `createServer`. */
export type ServerConfig = {
	name: string;
	version: string;
};

/** Configuration for `startServer`. */
export type StartConfig = {
	port: number;
	host: string;
	name: string;
	version: string;
};

/** Result of `startServer`: the bound address and a stop function. */
export type StartedServer = {
	port: number;
	host: string;
	stop: () => Promise<void>;
};
