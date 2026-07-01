import process from "node:process";
import { logger, TAG_GUARD } from "./logger.js";

/** Minimal event-target surface needed to (de)register a process guard. */
type GuardTarget = {
	on(event: "unhandledRejection", listener: (reason: unknown) => void): unknown;
	off(
		event: "unhandledRejection",
		listener: (reason: unknown) => void,
	): unknown;
};

export type UnhandledRejectionGuardOptions = {
	/**
	 * Emitter to attach to. Defaults to the global `process`. Injectable so the
	 * guard can be unit-tested against a plain EventEmitter without touching the
	 * real process-wide listeners.
	 */
	target?: GuardTarget;
	/** Sink for the rejection report. Defaults to structured logger. */
	log?: (message: string, reason: unknown) => void;
};

/**
 * Install a last-line-of-defense `unhandledRejection` guard (issue #177).
 *
 * The host spawns fire-and-forget background tasks (notably the detached
 * `readAdapterOutput` read loop). If such a task rejects with no `.catch()`,
 * Node surfaces it as an `unhandledRejection`; without a handler the whole
 * host process tears down and in-flight HTTP clients see `Connection refused`.
 *
 * This guard only *logs* the reason — it never calls `process.exit()` — so a
 * single session's adapter fault can never take down the host. It complements,
 * and does not replace, fixing the concrete reject sources (e.g. the `markIdle`
 * missing-session guard).
 *
 * @returns an uninstall function that removes the listener (used by tests).
 */
export function installUnhandledRejectionGuard(
	options: UnhandledRejectionGuardOptions = {},
): () => void {
	const target = options.target ?? process;
	const log =
		options.log ??
		((message: string, reason: unknown) => {
			logger.error(TAG_GUARD, `${message} ${String(reason)}`);
		});

	const listener = (reason: unknown): void => {
		log("[host] unhandledRejection", reason);
	};

	target.on("unhandledRejection", listener);
	return () => {
		target.off("unhandledRejection", listener);
	};
}
