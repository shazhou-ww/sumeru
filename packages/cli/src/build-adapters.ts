/**
 * Build the adapter registry for a Sumeru server from parsed gateway config.
 *
 * Walks the `gateways` map and dispatches on `gw.adapter` to the matching
 * built-in factory (hermes, claude-code). Each gateway's `gw.config` blob is
 * forwarded verbatim to the factory; absent / `null` blobs become `{}`.
 *
 * Unknown adapter names are silently skipped — the gateway then surfaces as
 * `status: "unavailable"` via `GET /gateways`. The CLI MUST NOT crash on a
 * gateway whose adapter package is not bundled.
 *
 * The factory map is injectable for tests; production code uses
 * {@link DEFAULT_ADAPTER_FACTORIES} which wires in the real built-in packages.
 *
 * See `specs/cli-pass-gateway-config.md` (issue #32).
 */
import { createClaudeCodeAdapter } from "@sumeru/adapter-claude-code";
import { createHermesAdapter } from "@sumeru/adapter-hermes";
import type { Adapter } from "@sumeru/core";
import type { GatewayConfig } from "@sumeru/server";

/**
 * A factory function that constructs an `Adapter` from an opaque options
 * blob. The blob's keys are validated by the adapter, not by the CLI.
 */
export type AdapterFactory = (opts: Record<string, unknown>) => Adapter;

/** Registry of adapter factories keyed by adapter name. */
export type AdapterFactoryMap = Record<string, AdapterFactory>;

/** Default factories — wires in the built-in adapter packages. */
export const DEFAULT_ADAPTER_FACTORIES: AdapterFactoryMap = {
	hermes: (opts) => createHermesAdapter(opts),
	"claude-code": (opts) => createClaudeCodeAdapter(opts),
};

/**
 * Walk a parsed `gateways` map and produce the adapter registry the server
 * needs. Per-gateway `config` blobs are forwarded verbatim; gateways whose
 * `adapter` field does not match a known factory are silently omitted.
 */
export function buildAdapters(
	gateways: Record<string, GatewayConfig>,
	factories: AdapterFactoryMap = DEFAULT_ADAPTER_FACTORIES,
): Record<string, Adapter> {
	const adapters: Record<string, Adapter> = {};
	for (const [name, gw] of Object.entries(gateways)) {
		const factory = factories[gw.adapter];
		if (factory === undefined) {
			// Adapter package not bundled by this CLI build — leave the
			// gateway's adapter slot empty so the registry reports
			// `status: "unavailable"`.
			continue;
		}
		const opts = gw.config ?? {};
		adapters[name] = factory(opts);
	}
	return adapters;
}
