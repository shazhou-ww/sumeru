import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import type { Transport, TransportExecSession } from "./types.js";

const ADAPTER_BASE = "/opt/sumeru";

function runCommand(
	args: Array<string>,
	cwd: string | null = null,
	env: Record<string, string> | null = null,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	return new Promise((resolve, reject) => {
		const child = spawn(args[0] as string, args.slice(1), {
			stdio: ["ignore", "pipe", "pipe"],
			cwd: cwd ?? undefined,
			env:
				env === null
					? undefined
					: {
							...process.env,
							...env,
						},
		});
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
		child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
		child.on("error", reject);
		child.on("close", (code) => {
			resolve({
				stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
				stderr: Buffer.concat(stderrChunks).toString("utf-8"),
				exitCode: code ?? 1,
			});
		});
	});
}

export function createDockerTransport(
	options: { dockerBin?: string; composeBin?: string } = {},
): Transport {
	const dockerBin = options.dockerBin ?? "docker";
	const composeBin = options.composeBin ?? "docker";

	return {
		async up({ projectName, composePath, workDir, projectPath, env }) {
			const composeEnv: Record<string, string> = {
				...(env ?? {}),
				SUMERU_PROJECT_PATH: projectPath,
			};
			const result = await runCommand(
				[
					composeBin,
					"compose",
					"-f",
					composePath,
					"-p",
					projectName,
					"up",
					"-d",
				],
				workDir,
				composeEnv,
			);
			if (result.exitCode !== 0) {
				throw new Error(
					`docker compose up failed: ${result.stderr || result.stdout}`,
				);
			}
			const ps = await runCommand(
				[
					composeBin,
					"compose",
					"-f",
					composePath,
					"-p",
					projectName,
					"ps",
					"-q",
				],
				workDir,
			);
			if (ps.exitCode !== 0) {
				throw new Error(`docker compose ps failed: ${ps.stderr || ps.stdout}`);
			}
			const firstContainer = ps.stdout.trim().split("\n")[0] ?? "";
			if (firstContainer.length === 0) {
				throw new Error(
					"docker compose up succeeded but no container id found",
				);
			}
			return { containerId: firstContainer };
		},

		async upFromImage({
			containerName,
			imageTag,
			workDir,
			projectPath,
			cacheDir,
			env,
		}) {
			const runEnv: Record<string, string> = {
				...(env ?? {}),
				SUMERU_PROJECT_PATH: projectPath,
			};
			const args = [
				dockerBin,
				"run",
				"-d",
				"--name",
				containerName,
				"--network",
				"host",
				"-v",
				`${projectPath}:${projectPath}`,
				"-v",
				`${cacheDir}/pnpm-store:/cache/pnpm-store`,
				"-v",
				`${cacheDir}/npm:/cache/npm`,
				"-v",
				`${cacheDir}/uv:/cache/uv`,
				"-v",
				`${cacheDir}/pip:/cache/pip`,
				"-w",
				"/workspace",
			];
			for (const [key, value] of Object.entries(runEnv)) {
				args.push("-e", `${key}=${value}`);
			}
			args.push(imageTag);
			const result = await runCommand(args, workDir);
			if (result.exitCode !== 0) {
				throw new Error(`docker run failed: ${result.stderr || result.stdout}`);
			}
			const containerId = result.stdout.trim();
			if (containerId.length === 0) {
				throw new Error("docker run succeeded but returned no container id");
			}
			return { containerId };
		},

		async down({ projectName, composePath, workDir }) {
			const result = await runCommand(
				[
					composeBin,
					"compose",
					"-f",
					composePath,
					"-p",
					projectName,
					"down",
					"-t",
					"2",
				],
				workDir,
			);
			if (result.exitCode !== 0) {
				throw new Error(
					`docker compose down failed: ${result.stderr || result.stdout}`,
				);
			}
		},

		async rm({ projectName, composePath, workDir }) {
			const result = await runCommand(
				[
					composeBin,
					"compose",
					"-f",
					composePath,
					"-p",
					projectName,
					"rm",
					"-f",
				],
				workDir,
			);
			if (result.exitCode !== 0) {
				throw new Error(
					`docker compose rm failed: ${result.stderr || result.stdout}`,
				);
			}
		},

		async rmContainer(containerId) {
			const result = await runCommand([dockerBin, "rm", "-f", containerId]);
			if (result.exitCode !== 0) {
				throw new Error(`docker rm failed: ${result.stderr || result.stdout}`);
			}
		},

		async stop(containerId) {
			const result = await runCommand([
				dockerBin,
				"stop",
				"-t",
				"5",
				containerId,
			]);
			if (result.exitCode !== 0) {
				throw new Error(
					`docker stop failed: ${result.stderr || result.stdout}`,
				);
			}
		},

		async start(containerId) {
			const result = await runCommand([dockerBin, "start", containerId]);
			if (result.exitCode !== 0) {
				throw new Error(
					`docker start failed: ${result.stderr || result.stdout}`,
				);
			}
		},

		exec({ containerId, command, env }) {
			const args = [dockerBin, "exec", "-i", "-w", ADAPTER_BASE];
			if (env !== null) {
				for (const [key, value] of Object.entries(env)) {
					args.push("-e", `${key}=${value}`);
				}
			}
			args.push(containerId, ...command);
			const child = spawn(args[0] as string, args.slice(1), {
				stdio: ["pipe", "pipe", "pipe"],
			});
			if (child.stdin === null || child.stdout === null) {
				throw new Error("docker exec missing stdio pipes");
			}
			const stderrChunks: Buffer[] = [];
			child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
			const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
			const exitPromise = new Promise<{
				exitCode: number | null;
				stderr: string;
			}>((resolve, reject) => {
				child.on("error", reject);
				child.on("close", (code) => {
					resolve({
						exitCode: code,
						stderr: Buffer.concat(stderrChunks).toString("utf-8"),
					});
				});
			});
			const session: TransportExecSession = {
				stdin: child.stdin,
				lines: rl,
				waitForExit: () => exitPromise,
			};
			return session;
		},

		async runOnce({ containerId, command, env }) {
			const args = [dockerBin, "exec", "-i", "-w", ADAPTER_BASE];
			if (env !== null) {
				for (const [key, value] of Object.entries(env)) {
					args.push("-e", `${key}=${value}`);
				}
			}
			args.push(containerId, ...command);
			return runCommand(args, null, env);
		},

		async commit({ containerId, tag, labels }) {
			const args = [dockerBin, "commit"];
			if (labels !== null) {
				for (const [key, value] of Object.entries(labels)) {
					args.push("--change", `LABEL ${key}=${value}`);
				}
			}
			args.push(containerId, tag);
			const result = await runCommand(args);
			if (result.exitCode !== 0) {
				throw new Error(
					`docker commit failed: ${result.stderr || result.stdout}`,
				);
			}
			const imageId = result.stdout.trim();
			if (imageId.length === 0) {
				throw new Error("docker commit succeeded but returned no image id");
			}
			return { imageId };
		},

		async inspectStatus(containerId) {
			const result = await runCommand([
				dockerBin,
				"inspect",
				"-f",
				"{{.State.Running}}",
				containerId,
			]);
			if (result.exitCode !== 0) {
				return "stopped";
			}
			const running = result.stdout.trim();
			if (running === "true") return "running";
			return "stopped";
		},
	};
}

export const SUMERU_SESSION_MAIN = `${ADAPTER_BASE}/sumeru-session/dist/main.js`;

export function legacyAdapterCommand(adapter: string): Array<string> {
	return ["node", `${ADAPTER_BASE}/adapter-${adapter}/dist/main.js`];
}

export function defaultAdapterCommand(adapter: string): Array<string> {
	const sessionMain = SUMERU_SESSION_MAIN;
	const legacyMain = `${ADAPTER_BASE}/adapter-${adapter}/dist/main.js`;
	return [
		"sh",
		"-c",
		`if [ -f "${sessionMain}" ]; then exec node "${sessionMain}"; else exec node "${legacyMain}"; fi`,
	];
}

export type MockTransportCall =
	| {
			type: "up";
			projectName: string;
			composePath: string;
			workDir: string;
			projectPath: string;
			env: Record<string, string> | null;
	  }
	| {
			type: "upFromImage";
			containerName: string;
			imageTag: string;
			workDir: string;
			projectPath: string;
			cacheDir: string;
			env: Record<string, string> | null;
	  }
	| { type: "down"; projectName: string; composePath: string; workDir: string }
	| { type: "rm"; projectName: string; composePath: string; workDir: string }
	| { type: "rmContainer"; containerId: string }
	| { type: "stop"; containerId: string }
	| { type: "start"; containerId: string }
	| {
			type: "exec";
			containerId: string;
			command: Array<string>;
			env: Record<string, string> | null;
	  }
	| {
			type: "runOnce";
			containerId: string;
			command: Array<string>;
			env: Record<string, string> | null;
	  }
	| {
			type: "commit";
			containerId: string;
			tag: string;
			labels: Record<string, string> | null;
	  }
	| { type: "inspectStatus"; containerId: string };

export function createMockTransport(
	options: {
		containerId?: string;
		status?: "running" | "stopped";
		execLines?: Array<string>;
		runOnceResult?: { stdout: string; stderr: string; exitCode: number };
		commitImageId?: string;
	} = {},
): { transport: Transport; calls: Array<MockTransportCall> } {
	const calls: Array<MockTransportCall> = [];
	const containerId = options.containerId ?? "mock-container-id";
	const status = options.status ?? "running";
	const execLines = options.execLines ?? [];
	const runOnceResult = options.runOnceResult ?? {
		stdout: "",
		stderr: "",
		exitCode: 0,
	};
	const commitImageId = options.commitImageId ?? "sha256:mock-image-id";

	const transport: Transport = {
		async up(input) {
			calls.push({ type: "up", ...input });
			return { containerId };
		},
		async upFromImage(input) {
			calls.push({ type: "upFromImage", ...input });
			return { containerId };
		},
		async down(input) {
			calls.push({ type: "down", ...input });
		},
		async rm(input) {
			calls.push({ type: "rm", ...input });
		},
		async rmContainer(containerIdArg) {
			calls.push({ type: "rmContainer", containerId: containerIdArg });
		},
		async stop(containerIdArg) {
			calls.push({ type: "stop", containerId: containerIdArg });
		},
		async start(containerIdArg) {
			calls.push({ type: "start", containerId: containerIdArg });
		},
		exec(input) {
			calls.push({ type: "exec", ...input });
			const stdin = new PassThrough();
			const stdout = new PassThrough();
			for (const line of execLines) {
				stdout.write(`${line}\n`);
			}
			const rl = createInterface({ input: stdout, crlfDelay: Infinity });
			return {
				stdin,
				lines: rl,
				waitForExit: async () => ({ exitCode: 0, stderr: "" }),
			};
		},
		async runOnce(input) {
			calls.push({ type: "runOnce", ...input });
			return runOnceResult;
		},
		async commit(input) {
			calls.push({ type: "commit", ...input });
			return { imageId: commitImageId };
		},
		async inspectStatus(containerIdArg) {
			calls.push({ type: "inspectStatus", containerId: containerIdArg });
			return status;
		},
	};

	return { transport, calls };
}
