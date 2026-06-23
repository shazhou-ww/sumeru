import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The three Docker-mode orchestration templates shipped inside `@sumeru/server`
 * under `templates/docker/`. Order is stable so callers (and tests) can rely on
 * the returned path list.
 */
const TEMPLATE_FILES = [
	"Dockerfile",
	"docker-compose.yaml",
	"sumeru.env.example",
] as const;

/**
 * Resolve the packaged `templates/docker/` directory relative to THIS module's
 * compiled location — never `process.cwd()`. At run time this file is
 * `dist/docker-assets.js`, so the templates sit one level up at
 * `../templates/docker/`. This is what makes Docker mode work when
 * `@sumeru/server` lives under the `node_modules` of a globally-installed
 * `@sumeru/cli`, where there is no source tree and `cwd` is arbitrary.
 */
function templateSourceDir(): string {
	const here = dirname(fileURLToPath(import.meta.url));
	return join(here, "..", "templates", "docker");
}

/**
 * Copy the three packaged Docker templates verbatim into `targetDir`.
 *
 * Byte-for-byte copy — zero string rendering. All variability is deferred to
 * compose's native `${VAR:-default}` interpolation at run time. Creates
 * `targetDir` (recursively) if it does not exist. Idempotent: a second call
 * simply overwrites the unchanged template bytes.
 *
 * Returns the absolute paths actually written, in stable order, one per
 * template.
 */
export function materializeDockerAssets(targetDir: string): string[] {
	mkdirSync(targetDir, { recursive: true });
	const sourceDir = templateSourceDir();
	const written: string[] = [];
	for (const name of TEMPLATE_FILES) {
		const dest = join(targetDir, name);
		copyFileSync(join(sourceDir, name), dest);
		written.push(dest);
	}
	return written;
}
