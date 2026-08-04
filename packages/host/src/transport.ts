import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { PassThrough } from "node:stream";
import Docker from "dockerode";
import { parse as parseYaml } from "yaml";
import type { Transport, TransportExecSession } from "./types.js";

const CONTAINER_WORKDIR = "/workspace";

let dockerClient: Docker | null = null;

function getDocker(): Docker {
	if (!dockerClient) {
		dockerClient = new Docker();
	}
	return dockerClient;
}

/** Exposed for tests that need a fresh client after mocking. */
export function resetDockerClient(): void {
	dockerClient = null;
	dockerdEnsured = false;
}

let dockerdEnsured = false;

/**
 * Ensure dockerd is running. On the host, this is a no-op (dockerd already runs).
 * Inside a DinD container, starts dockerd with fuse-overlayfs if not already running.
 * Called lazily before the first Docker operation (up/commit/exec/etc.).
 */
export async function ensureDockerd(): Promise<void> {
	if (dockerdEnsured) return;
	const docker = getDocker();

	// Check if dockerd is already running (host or previously started in-container)
	try {
		await docker.ping();
		dockerdEnsured = true;
		return;
	} catch {
		// Not running — check if dockerd binary exists (i.e., we're in a DinD container)
	}

	try {
		execSync("which dockerd", { stdio: "ignore" });
	} catch {
		// No dockerd binary — this is the host. Docker should be running.
		throw new Error("Docker is not available. Is the Docker daemon running?");
	}

	// Clean stale runtime state from parent's committed layer
	try {
		execSync(
			"rm -rf /var/run/docker /var/run/docker.pid /var/run/docker.sock",
			{
				stdio: "ignore",
			},
		);
	} catch {
		/* ignore */
	}

	// Start dockerd with fuse-overlayfs (vfs loses permissions, overlay2 doesn't nest)
	try {
		execSync("dockerd --storage-driver=fuse-overlayfs > /dev/null 2>&1 &", {
			stdio: "ignore",
		});
	} catch {
		/* ignore — will check below */
	}

	// Wait for dockerd to be ready (up to 30s)
	for (let i = 0; i < 60; i++) {
		try {
			await docker.ping();
			dockerdEnsured = true;
			return;
		} catch {
			await new Promise((r) => setTimeout(r, 500));
		}
	}

	throw new Error("Docker daemon failed to start within 30 seconds");
}

function formatDockerError(err: unknown): Error {
	if (err instanceof Error) {
		const msg = err.message;
		if (
			msg.includes("ENOENT") ||
			msg.includes("ECONNREFUSED") ||
			msg.includes("connect") ||
			msg.includes("docker.sock")
		) {
			return new Error(
				`Docker is not available (${msg}). Is the Docker daemon running?`,
			);
		}
		return err;
	}
	return new Error(String(err));
}

function envToArray(
	env: Record<string, string> | null | undefined,
): Array<string> | undefined {
	if (env === null || env === undefined) {
		return undefined;
	}
	const entries = Object.entries(env);
	if (entries.length === 0) {
		return undefined;
	}
	return entries.map(([key, value]) => `${key}=${value}`);
}

function substituteEnv(template: string, env: Record<string, string>): string {
	return template.replace(/\$\{([^}]+)\}/g, (_match, key: string) => {
		return env[key] ?? process.env[key] ?? "";
	});
}

function splitImageTag(imageTag: string): { repo: string; tag: string } {
	const colon = imageTag.lastIndexOf(":");
	if (colon === -1) {
		return { repo: imageTag, tag: "latest" };
	}
	const slash = imageTag.lastIndexOf("/");
	if (slash > colon) {
		return { repo: imageTag, tag: "latest" };
	}
	return {
		repo: imageTag.slice(0, colon),
		tag: imageTag.slice(colon + 1),
	};
}

type ComposeService = {
	image: string | null;
	volumes: Array<string>;
	workingDir: string | null;
	command: Array<string> | null;
	networkMode: string | null;
};

function parseComposeService(composePath: string, raw: string): ComposeService {
	const doc = parseYaml(raw);
	if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
		throw new Error(`Invalid compose file: ${composePath}`);
	}
	const services = (doc as Record<string, unknown>).services;
	if (
		services === null ||
		typeof services !== "object" ||
		Array.isArray(services)
	) {
		throw new Error(`Compose ${composePath} has no services`);
	}
	for (const service of Object.values(services as Record<string, unknown>)) {
		if (
			service === null ||
			typeof service !== "object" ||
			Array.isArray(service)
		) {
			continue;
		}
		const record = service as Record<string, unknown>;
		const image = typeof record.image === "string" ? record.image : null;
		const volumes: Array<string> = [];
		if (Array.isArray(record.volumes)) {
			for (const entry of record.volumes) {
				if (typeof entry === "string") {
					volumes.push(entry);
				}
			}
		}
		const workingDir =
			typeof record.working_dir === "string" ? record.working_dir : null;
		let command: Array<string> | null = null;
		if (typeof record.command === "string") {
			command = ["sh", "-c", record.command];
		} else if (Array.isArray(record.command)) {
			command = record.command.filter(
				(item): item is string => typeof item === "string",
			);
		}
		const networkMode =
			typeof record.network_mode === "string" ? record.network_mode : null;
		return { image, volumes, workingDir, command, networkMode };
	}
	throw new Error(`Compose ${composePath} declares no usable services`);
}

async function collectExecOutput(
	docker: Docker,
	stream: NodeJS.ReadableStream,
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const stdoutStream = new PassThrough();
		const stderrStream = new PassThrough();
		const stdoutChunks: Array<Buffer> = [];
		const stderrChunks: Array<Buffer> = [];
		stdoutStream.on("data", (chunk: Buffer) => {
			stdoutChunks.push(Buffer.from(chunk));
		});
		stderrStream.on("data", (chunk: Buffer) => {
			stderrChunks.push(Buffer.from(chunk));
		});
		docker.modem.demuxStream(stream, stdoutStream, stderrStream);
		stream.on("end", () => {
			stdoutStream.end();
			stderrStream.end();
			resolve({
				stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
				stderr: Buffer.concat(stderrChunks).toString("utf-8"),
			});
		});
		stream.on("error", reject);
	});
}

export function createDockerTransport(
	_options: { dockerBin?: string; composeBin?: string } = {},
): Transport {
	return {
		async up({ projectName, composePath, projectPath, env }) {
			await ensureDockerd();
			const composeEnv: Record<string, string> = {
				...(env ?? {}),
			};
			if (projectPath !== null) {
				composeEnv.SUMERU_PROJECT_PATH = projectPath;
			}
			try {
				const raw = await readFile(composePath, "utf-8");
				const service = parseComposeService(composePath, raw);
				if (service.image === null || service.image.length === 0) {
					throw new Error(`Compose ${composePath} service has no image`);
				}
				const image = substituteEnv(service.image, composeEnv);
				const binds = service.volumes.map((volume) =>
					substituteEnv(volume, composeEnv),
				);
				const docker = getDocker();
				const createOpts: Docker.ContainerCreateOptions = {
					name: projectName,
					Image: image,
					Env: envToArray(composeEnv),
					HostConfig: {
						Binds: binds.length > 0 ? binds : undefined,
						NetworkMode: service.networkMode ?? undefined,
					},
				};
				if (service.workingDir !== null) {
					createOpts.WorkingDir = substituteEnv(service.workingDir, composeEnv);
				}
				if (service.command !== null && service.command.length > 0) {
					createOpts.Cmd = service.command.map((part) =>
						substituteEnv(part, composeEnv),
					);
				}
				const container = await docker.createContainer(createOpts);
				await container.start();
				return { containerId: container.id };
			} catch (err) {
				throw formatDockerError(err);
			}
		},

		async upFromImage({ containerName, imageTag, projectPath, cacheDir, env }) {
			await ensureDockerd();
			const runEnv: Record<string, string> = {
				...(env ?? {}),
			};
			if (projectPath !== null) {
				runEnv.SUMERU_PROJECT_PATH = projectPath;
			}
			const binds: Array<string> = [];
			if (projectPath !== null) {
				binds.push(`${projectPath}:/workspace:rw`);
			}
			binds.push(
				`${cacheDir}/pnpm-store:/cache/pnpm-store`,
				`${cacheDir}/npm:/cache/npm`,
				`${cacheDir}/uv:/cache/uv`,
				`${cacheDir}/pip:/cache/pip`,
			);
			try {
				const docker = getDocker();
				const createOpts: Docker.ContainerCreateOptions = {
					name: containerName,
					Image: imageTag,
					Env: envToArray(runEnv),
					HostConfig: {
						NetworkMode: "host",
						Binds: binds,
					},
				};
				if (projectPath !== null) {
					createOpts.WorkingDir = "/workspace";
				}
				const container = await docker.createContainer(createOpts);
				await container.start();
				return { containerId: container.id };
			} catch (err) {
				throw formatDockerError(err);
			}
		},

		async down({ projectName }) {
			try {
				const container = getDocker().getContainer(projectName);
				await container.stop({ t: 2 });
			} catch (err) {
				const statusCode =
					err && typeof err === "object" && "statusCode" in err
						? (err as { statusCode?: number }).statusCode
						: undefined;
				if (statusCode === 304 || statusCode === 404) {
					return;
				}
				throw formatDockerError(err);
			}
		},

		async rm({ projectName }) {
			try {
				const container = getDocker().getContainer(projectName);
				await container.remove({ force: true });
			} catch (err) {
				const statusCode =
					err && typeof err === "object" && "statusCode" in err
						? (err as { statusCode?: number }).statusCode
						: undefined;
				if (statusCode === 404) {
					return;
				}
				throw formatDockerError(err);
			}
		},

		async rmContainer(containerId) {
			try {
				await getDocker().getContainer(containerId).remove({ force: true });
			} catch (err) {
				throw formatDockerError(err);
			}
		},

		async stop(containerId) {
			try {
				await getDocker().getContainer(containerId).stop({ t: 5 });
			} catch (err) {
				throw formatDockerError(err);
			}
		},

		async start(containerId) {
			try {
				await getDocker().getContainer(containerId).start();
			} catch (err) {
				throw formatDockerError(err);
			}
		},

		exec({ containerId, command, env }) {
			const stdin = new PassThrough();
			const stdout = new PassThrough();
			const stderrChunks: Array<Buffer> = [];
			const deferred: {
				resolve:
					| ((value: { exitCode: number | null; stderr: string }) => void)
					| null;
				reject: ((err: unknown) => void) | null;
			} = { resolve: null, reject: null };
			const exitPromise = new Promise<{
				exitCode: number | null;
				stderr: string;
			}>((resolve, reject) => {
				deferred.resolve = resolve;
				deferred.reject = reject;
			});
			const resolveExit = (value: {
				exitCode: number | null;
				stderr: string;
			}): void => {
				deferred.resolve?.(value);
			};
			const rejectExit = (err: unknown): void => {
				deferred.reject?.(err);
			};

			void (async () => {
				try {
					const docker = getDocker();
					const container = docker.getContainer(containerId);
					const execHandle = await container.exec({
						Cmd: command,
						AttachStdin: true,
						AttachStdout: true,
						AttachStderr: true,
						WorkingDir: CONTAINER_WORKDIR,
						Env: envToArray(env),
					});
					const stream = await execHandle.start({
						hijack: true,
						stdin: true,
					});
					const remoteStdout = new PassThrough();
					const remoteStderr = new PassThrough();
					docker.modem.demuxStream(stream, remoteStdout, remoteStderr);
					remoteStdout.on("data", (chunk: Buffer) => {
						stdout.write(chunk);
					});
					remoteStderr.on("data", (chunk: Buffer) => {
						stderrChunks.push(Buffer.from(chunk));
					});
					stdin.pipe(stream);
					stream.on("end", () => {
						stdout.end();
						void execHandle
							.inspect()
							.then((inspected) => {
								resolveExit({
									exitCode: inspected.ExitCode ?? null,
									stderr: Buffer.concat(stderrChunks).toString("utf-8"),
								});
							})
							.catch((err: unknown) => {
								rejectExit(formatDockerError(err));
							});
					});
					stream.on("error", (err: Error) => {
						rejectExit(formatDockerError(err));
					});
				} catch (err) {
					stdout.end();
					rejectExit(formatDockerError(err));
				}
			})();

			const rl = createInterface({ input: stdout, crlfDelay: Infinity });
			const session: TransportExecSession = {
				stdin,
				lines: rl,
				waitForExit: () => exitPromise,
			};
			return session;
		},

		async runOnce({ containerId, command, env }) {
			try {
				const docker = getDocker();
				const container = docker.getContainer(containerId);
				const execHandle = await container.exec({
					Cmd: command,
					AttachStdin: false,
					AttachStdout: true,
					AttachStderr: true,
					WorkingDir: CONTAINER_WORKDIR,
					Env: envToArray(env),
				});
				const stream = await execHandle.start({ hijack: true, stdin: false });
				const output = await collectExecOutput(docker, stream);
				const inspected = await execHandle.inspect();
				return {
					stdout: output.stdout,
					stderr: output.stderr,
					exitCode: inspected.ExitCode ?? 1,
				};
			} catch (err) {
				throw formatDockerError(err);
			}
		},

		async commit({ containerId, tag, labels }) {
			await ensureDockerd();
			try {
				const { repo, tag: imageTag } = splitImageTag(tag);
				const changes =
					labels === null
						? undefined
						: Object.entries(labels).map(
								([key, value]) => `LABEL ${key}=${value}`,
							);
				const result = await getDocker().getContainer(containerId).commit({
					repo,
					tag: imageTag,
					changes,
				});
				const imageId =
					typeof result === "object" &&
					result !== null &&
					"Id" in result &&
					typeof (result as { Id: unknown }).Id === "string"
						? (result as { Id: string }).Id
						: "";
				if (imageId.length === 0) {
					throw new Error("docker commit succeeded but returned no image id");
				}
				return { imageId };
			} catch (err) {
				throw formatDockerError(err);
			}
		},

		async inspectStatus(containerId) {
			try {
				const info = await getDocker().getContainer(containerId).inspect();
				if (info.State.Running) {
					return "running";
				}
				return "stopped";
			} catch {
				return "stopped";
			}
		},
	};
}

export function defaultAdapterCommand(_adapter: string): Array<string> {
	return ["sumeru-adapter"];
}

export type MockTransportCall =
	| {
			type: "up";
			projectName: string;
			composePath: string;
			workDir: string;
			projectPath: string | null;
			env: Record<string, string> | null;
	  }
	| {
			type: "upFromImage";
			containerName: string;
			imageTag: string;
			workDir: string;
			projectPath: string | null;
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
