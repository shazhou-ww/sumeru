/**
 * @sumeru/server — HTTP service for the Sumeru observation lab.
 *
 * Phase 1: configuration-driven instance + gateway endpoints.
 * All responses follow the ocas envelope: { type, value }.
 */

// ─── Envelope ────────────────────────────────────────────

/** Generic ocas-style envelope. Every HTTP response body uses this shape. */
export type Envelope<T> = {
	type: string;
	value: T;
};

// ─── Config (Phase 1) ────────────────────────────────────

/** Capability flags for a gateway. Both fields are required booleans. */
export type GatewayCapabilities = {
	resume: boolean;
	streaming: boolean;
};

/** A single gateway entry inside the parsed `sumeru.yaml`. */
export type GatewayConfig = {
	adapter: string;
	capabilities: GatewayCapabilities;
};

/** Parsed `sumeru.yaml`. Order of `gateways` keys is preserved. */
export type InstanceConfig = {
	name: string;
	gateways: Record<string, GatewayConfig>;
};

// ─── Instance ────────────────────────────────────────────

/** The instance value returned by `GET /`. */
export type Instance = {
	name: string;
	version: string;
	gateways: string[];
};

/**
 * A registered gateway, as returned by `GET /gateways` and `GET /gateways/:name`.
 *
 * In Phase 1 `status` is always `"ready"` and `activeSessions` is always `0`;
 * sessions land in Phase 2.
 */
export type Gateway = {
	name: string;
	adapter: string;
	status: string;
	activeSessions: number;
	capabilities: GatewayCapabilities;
};

// ─── Errors ──────────────────────────────────────────────

/** Error body shape, wrapped in `{ type: "@sumeru/error", value }`. */
export type ErrorValue = {
	error: string;
	message: string;
};

// ─── Server ──────────────────────────────────────────────

/** Configuration for `createHandler`. */
export type ServerConfig = {
	name: string;
	version: string;
	gateways: Record<string, GatewayConfig>;
};

/** Configuration for `startServer`. */
export type StartConfig = {
	port: number;
	host: string;
	name: string;
	version: string;
	gateways: Record<string, GatewayConfig>;
};

/** Result of `startServer`: the bound address and a stop function. */
export type StartedServer = {
	port: number;
	host: string;
	stop: () => Promise<void>;
};
