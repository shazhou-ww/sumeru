import { homedir } from "node:os";
import { join } from "node:path";
import type { DetectedAdapter } from "../detect.js";
import { codexHarness } from "./codex.js";
import { sarsapaHarness } from "./sarsapa.js";
import type { HarnessConfig } from "./types.js";

function homeHarness(options: {
	resetPaths: Array<string>;
	personaFile: string;
	skillsSubdir: string;
	modelConfigPath: string | null;
}): HarnessConfig {
	const home = homedir();
	return {
		resetPaths: options.resetPaths.map((segment) => join(home, segment)),
		personaPath: join(home, options.personaFile),
		skillsDir: join(home, options.skillsSubdir),
		modelConfigPath:
			options.modelConfigPath === null
				? null
				: join(home, options.modelConfigPath),
		writeModelConfig: null,
		installSkill: null,
	};
}

const HARNESS_BY_ADAPTER: Record<DetectedAdapter, HarnessConfig> = {
	sarsapa: sarsapaHarness,
	hermes: homeHarness({
		resetPaths: [".hermes"],
		personaFile: ".hermes/SOUL.md",
		skillsSubdir: ".hermes/skills",
		modelConfigPath: ".hermes/config.yaml",
	}),
	"claude-code": homeHarness({
		resetPaths: [".claude"],
		personaFile: "CLAUDE.md",
		skillsSubdir: ".cursor/skills",
		modelConfigPath: null,
	}),
	"cursor-agent": homeHarness({
		resetPaths: [".cursor"],
		personaFile: ".cursorrules",
		skillsSubdir: ".cursor/skills",
		modelConfigPath: null,
	}),
	codex: codexHarness,
};

export function getHarnessConfig(adapter: DetectedAdapter): HarnessConfig {
	return HARNESS_BY_ADAPTER[adapter];
}

export type { HarnessConfig } from "./types.js";
