import { exec } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import type { Adapter } from "@sumeru/core";
import { readAdapterManifest } from "./adapter-manifest.js";
import { ensureDockerd } from "./transport.js";

const execAsync = promisify(exec);

/**
 * Check whether a Docker image with the given tag already exists locally.
 */
export async function imageExists(imageTag: string): Promise<boolean> {
	try {
		await execAsync(`docker image inspect ${imageTag} 2>/dev/null`);
		return true;
	} catch {
		return false;
	}
}

/**
 * Build a Docker image from an adapter package directory.
 *
 * Skips the build if an image with the same tag already exists locally.
 * Returns the image tag on success.
 */
export async function buildAdapterImage(
	adapter: Adapter,
	packagePath: string,
): Promise<string> {
	try {
		await ensureDockerd();
	} catch {
		throw new Error("Docker daemon not available");
	}

	const manifest = await readAdapterManifest(packagePath);
	const dockerfilePath = join(packagePath, manifest.dockerfilePath);

	if (!existsSync(dockerfilePath)) {
		throw new Error(`Dockerfile not found: ${dockerfilePath}`);
	}

	const imageTag = adapter.imageTag;

	if (await imageExists(imageTag)) {
		return imageTag;
	}

	// Use project root as build context so Dockerfile can COPY from other packages
	const projectRoot = resolve(packagePath, "../..");

	try {
		await execAsync(
			`docker build -t ${imageTag} -f ${dockerfilePath} ${projectRoot}`,
		);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(`Docker build failed: ${message}`);
	}

	return imageTag;
}
