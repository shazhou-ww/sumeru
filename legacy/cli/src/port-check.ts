/**
 * Port conflict detection + force-kill helpers for `sumeru start` (issue #33).
 *
 * - `lookupPortHolder(host, port)` shells out to `lsof -i :<port>
 *   -sTCP:LISTEN -t -P -n` to identify the process bound to the port.
 *   Returns `null` if lsof is missing OR no holder is found OR the helper
 *   fails for any reason — the caller should fall back to a generic
 *   diagnostic.
 * - `formatPortInUse({ host, port, holder })` produces the operator-facing
 *   error block.
 * - `killHolder(pid, port, host)` sends SIGTERM, waits up to 2s for the port
 *   to free, then SIGKILLs. Throws if the kill itself errors (e.g. EPERM).
 *
 * See specs/cli-startup-port-check.md.
 */

import { spawn } from "node:child_process";
import { createConnection } from "node:net";

export type PortHolder = {
	pid: number;
	command: string;
};

export type FormatPortInUseOptions = {
	host: string;
	port: number;
	holder: PortHolder | null;
};

/**
 * Resolve the process listening on `host:port` via lsof. Returns null if:
 *   - lsof is not on PATH (ENOENT spawn error),
 *   - lsof exits non-zero (no holder found),
 *   - the holder pid cannot be parsed,
 *   - any other error — we never throw to the caller.
 */
export async function lookupPortHolder(
	_host: string,
	port: number,
): Promise<PortHolder | null> {
	const pid = await runLsofForPid(port);
	if (pid === null) return null;
	const command = await readCommandForPid(pid);
	return { pid, command };
}

function runLsofForPid(port: number): Promise<number | null> {
	return new Promise((resolve) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(
				"lsof",
				["-i", `:${port}`, "-sTCP:LISTEN", "-t", "-P", "-n"],
				{ stdio: ["ignore", "pipe", "ignore"] },
			);
		} catch {
			resolve(null);
			return;
		}
		let out = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			out += chunk.toString("utf-8");
		});
		child.on("error", () => resolve(null));
		child.on("close", () => {
			const first = out.split("\n").find((line) => /^\d+$/.test(line.trim()));
			if (first === undefined) {
				resolve(null);
				return;
			}
			const pid = Number.parseInt(first.trim(), 10);
			if (!Number.isFinite(pid) || pid <= 0) {
				resolve(null);
				return;
			}
			resolve(pid);
		});
	});
}

function readCommandForPid(pid: number): Promise<string> {
	return new Promise((resolve) => {
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn("ps", ["-p", String(pid), "-o", "comm="], {
				stdio: ["ignore", "pipe", "ignore"],
			});
		} catch {
			resolve("unknown");
			return;
		}
		let out = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			out += chunk.toString("utf-8");
		});
		child.on("error", () => resolve("unknown"));
		child.on("close", () => {
			const trimmed = out.trim();
			resolve(trimmed.length > 0 ? trimmed : "unknown");
		});
	});
}

/**
 * Render the diagnostic the CLI prints when `EADDRINUSE` is caught.
 *
 * - When the holder is identified (lsof present, pid resolved), emit the
 *   multi-line block with `Held by pid …` and a `--force` hint.
 * - When the holder is unknown (lsof missing OR could not identify), fall
 *   back to the legacy single-line message — no `--force` hint, since
 *   without a target pid `--force` cannot do anything anyway.
 *
 * See specs/cli-startup-port-check.md.
 */
export function formatPortInUse(opts: FormatPortInUseOptions): string {
	const { host, port, holder } = opts;
	if (holder === null) {
		return `Port ${port} is already in use on ${host}. Choose a different --port or stop the conflicting process.`;
	}
	return [
		`Port ${port} is already in use on ${host}.`,
		`  Held by pid ${holder.pid} (${holder.command})`,
		`  Run \`sumeru start --port ${port} --force\` to terminate it, or pick a different --port.`,
	].join("\n");
}

/**
 * Send SIGTERM to `pid`. Wait up to `gracefulMs` for the port to free; if
 * still bound, send SIGKILL. Resolves once the port is free or after
 * `gracefulMs + killWaitMs` total.
 *
 * Throws if `process.kill` itself fails (e.g. EPERM or ESRCH at SIGTERM
 * time — both are operator-actionable conditions).
 */
export async function killHolder(
	pid: number,
	port: number,
	host: string,
	gracefulMs = 2_000,
): Promise<void> {
	process.kill(pid, "SIGTERM");
	const start = Date.now();
	while (Date.now() - start < gracefulMs) {
		if (!(await isPortBound(host, port))) return;
		await sleep(100);
	}
	// Still bound — escalate.
	try {
		process.kill(pid, "SIGKILL");
	} catch (err) {
		if (
			err !== null &&
			typeof err === "object" &&
			"code" in err &&
			(err as { code: unknown }).code === "ESRCH"
		) {
			// Already gone between SIGTERM and SIGKILL. That's fine.
			return;
		}
		throw err;
	}
	// Best-effort wait for the kernel to release the socket.
	const killStart = Date.now();
	while (Date.now() - killStart < 1_000) {
		if (!(await isPortBound(host, port))) return;
		await sleep(50);
	}
}

function isPortBound(host: string, port: number): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = createConnection({ host, port });
		const done = (bound: boolean): void => {
			socket.removeAllListeners();
			socket.destroy();
			resolve(bound);
		};
		socket.once("connect", () => done(true));
		socket.once("error", () => done(false));
	});
}

function sleep(ms: number): Promise<void> {
	return new Promise((res) => setTimeout(res, ms));
}
