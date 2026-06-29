import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { InstanceStatus } from "./legacy-types.js";
import type { Transport, TransportExecSession } from "./types.js";

export const LOCAL_MASTER_HANDLE = "master";

export type LocalTransport = {
	create(): string;
	spawn(handleId: string, command: Array<string>, env: Record<string, string> | null): TransportExecSession;
	stop(handleId: string): void;
	destroy(): void;
};

export function createLocalTransportImpl(options: {
	adapterCommand: Array<string>;
}): LocalTransport {
	const children = new Map<string, ChildProcessWithoutNullStreams>();

	function create(): string {
		return LOCAL_MASTER_HANDLE;
	}

	function spawnHandle(
		handleId: string,
		command: Array<string>,
		env: Record<string, string> | null,
	): TransportExecSession {
		stop(handleId);
		const resolvedCommand =
			command.length > 0 ? command : options.adapterCommand;
		if (resolvedCommand.length === 0) {
			throw new Error("local transport adapter command is empty");
		}
		const child = spawn(
			resolvedCommand[0] as string,
			resolvedCommand.slice(1),
			{
				stdio: ["pipe", "pipe", "pipe"],
				env:
					env === null
						? undefined
						: {
								...process.env,
								...env,
							},
			},
		);
		if (child.stdin === null || child.stdout === null) {
			throw new Error("local transport spawn missing stdio pipes");
		}
		children.set(handleId, child);
		const stderrChunks: Buffer[] = [];
		child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
		const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
		const exitPromise = new Promise<{
			exitCode: number | null;
			stderr: string;
		}>((resolve, reject) => {
			child.on("error", reject);
			child.on("close", (code) => {
				children.delete(handleId);
				resolve({
					exitCode: code,
					stderr: Buffer.concat(stderrChunks).toString("utf-8"),
				});
			});
		});
		return {
			stdin: child.stdin,
			lines: rl,
			waitForExit: () => exitPromise,
		};
	}

	function stop(handleId: string): void {
		const child = children.get(handleId);
		if (child === undefined) return;
		child.kill("SIGTERM");
		children.delete(handleId);
	}

	function destroy(): void {
		for (const handleId of [...children.keys()]) {
			stop(handleId);
		}
	}

	return {
		create,
		spawn: spawnHandle,
		stop,
		destroy,
	};
}

export function createLocalTransport(options: {
	adapterCommand: Array<string>;
}): Transport {
	const local = createLocalTransportImpl(options);

	return {
		async up(_params) {
			local.create();
			return { containerId: LOCAL_MASTER_HANDLE };
		},
		async down() {
			local.stop(LOCAL_MASTER_HANDLE);
		},
		async rm() {
			local.destroy();
		},
		exec({ containerId, command, env }) {
			return local.spawn(containerId, command, env);
		},
		async inspectStatus(containerId) {
			void containerId;
			return "running" satisfies InstanceStatus;
		},
	};
}

export function createRoutingTransport(input: {
	docker: Transport;
	local: Transport;
	masterProjectName: string;
}): Transport {
	return {
		async up(params) {
			if (params.projectName === input.masterProjectName) {
				return input.local.up(params);
			}
			return input.docker.up(params);
		},
		async down(params) {
			if (params.projectName === input.masterProjectName) {
				await input.local.down(params);
				return;
			}
			await input.docker.down(params);
		},
		async rm(params) {
			if (params.projectName === input.masterProjectName) {
				await input.local.rm(params);
				return;
			}
			await input.docker.rm(params);
		},
		exec(params) {
			if (params.containerId === LOCAL_MASTER_HANDLE) {
				return input.local.exec(params);
			}
			return input.docker.exec(params);
		},
		async inspectStatus(containerId) {
			if (containerId === LOCAL_MASTER_HANDLE) {
				return input.local.inspectStatus(containerId);
			}
			return input.docker.inspectStatus(containerId);
		},
	};
}
