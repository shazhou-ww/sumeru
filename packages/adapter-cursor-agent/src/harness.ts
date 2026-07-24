import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
	HarnessConfig,
	InstallSkillControlValue,
	ModelControlValue,
} from "@sumeru/adapter-core";

export type CursorAgentModelConfig = {
	model: string;
	apiKey: string | null;
};

export function formatCursorAgentModelConfig(value: ModelControlValue): string {
	const config: CursorAgentModelConfig = {
		model: value.model,
		apiKey: value.apiKey,
	};
	return `${JSON.stringify(config, null, 2)}\n`;
}

async function writeCursorAgentModelConfig(
	modelConfigPath: string,
	value: ModelControlValue,
): Promise<void> {
	await mkdir(dirname(modelConfigPath), { recursive: true });
	await writeFile(modelConfigPath, formatCursorAgentModelConfig(value), "utf8");
}

async function installCursorAgentSkill(
	skillsDir: string,
	value: InstallSkillControlValue,
): Promise<void> {
	await mkdir(skillsDir, { recursive: true });
	await writeFile(join(skillsDir, `${value.name}.md`), value.content, "utf8");
	for (const file of value.files) {
		const filePath = join(skillsDir, value.name, file.path);
		await mkdir(dirname(filePath), { recursive: true });
		await writeFile(filePath, file.content, "utf8");
	}
}

const cursorDir = join(homedir(), ".cursor");
const adapterStateDir = join(homedir(), ".cursor-agent-adapter");

export const cursorAgentHarness: HarnessConfig = {
	resetPaths: [join(cursorDir, "sessions"), adapterStateDir],
	modelConfigPath: join(cursorDir, "config.json"),
	personaPath: join(cursorDir, "rules", "sumeru.md"),
	skillsDir: join(cursorDir, "rules", "skills"),
	writeModelConfig: async (value) => {
		if (cursorAgentHarness.modelConfigPath === null) {
			return;
		}
		await writeCursorAgentModelConfig(
			cursorAgentHarness.modelConfigPath,
			value,
		);
	},
	installSkill: async (value) => {
		if (cursorAgentHarness.skillsDir === null) {
			return;
		}
		await installCursorAgentSkill(cursorAgentHarness.skillsDir, value);
	},
};
