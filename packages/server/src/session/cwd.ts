/**
 * Resolve a per-session `config.cwd` against the instance `workspaceRoot`.
 *
 * Single source of truth for the cwd-resolution policy used by
 * `POST /gateways/:name/sessions`. Both the HTTP handler and tests import
 * this helper.
 *
 * Rules:
 *
 *   - `rawCwd` is `undefined` / `null`           → `{ ok: true, cwd: null }`
 *   - `rawCwd` is the empty string               → `{ ok: true, cwd: null }`
 *   - `rawCwd` is not a string (and not absent)  → `{ ok: false, … }`
 *   - non-empty string AND workspaceRoot set     → `path.resolve(root, raw)`,
 *                                                  rejected if it escapes root
 *   - non-empty string AND workspaceRoot null    → must be absolute (verbatim);
 *                                                  relative is rejected
 *
 * The resolved value is the absolute path the adapter should be told to use
 * (replacing the user-supplied `cwd` in the opaque config blob). The wire
 * envelope returned to the client is left untouched — only the adapter sees
 * the resolved form.
 */

import { isAbsolute, resolve as pathResolve, sep } from "node:path";

export type ResolveCwdResult =
	| { ok: true; cwd: string | null }
	| { ok: false; message: string };

export function resolveSessionCwd(
	workspaceRoot: string | null,
	rawCwd: unknown,
): ResolveCwdResult {
	if (rawCwd === undefined || rawCwd === null) {
		return { ok: true, cwd: null };
	}
	if (typeof rawCwd !== "string") {
		return { ok: false, message: "config.cwd must be a string" };
	}
	if (rawCwd.length === 0) {
		return { ok: true, cwd: null };
	}

	if (workspaceRoot !== null) {
		const root = pathResolve(workspaceRoot);
		const resolved = pathResolve(root, rawCwd);
		if (resolved !== root && !resolved.startsWith(root + sep)) {
			return {
				ok: false,
				message: `config.cwd '${rawCwd}' resolves outside workspaceRoot '${workspaceRoot}'`,
			};
		}
		return { ok: true, cwd: resolved };
	}

	// No workspaceRoot configured — only absolute paths are accepted.
	if (!isAbsolute(rawCwd)) {
		return {
			ok: false,
			message: `config.cwd '${rawCwd}' must be absolute when no workspaceRoot is configured`,
		};
	}
	return { ok: true, cwd: rawCwd };
}
