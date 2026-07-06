import type {
	InstallSkillControlValue,
	ModelControlValue,
} from "./control-frames.js";

export type HarnessConfig = {
	resetPaths: Array<string>;
	modelConfigPath: string | null;
	personaPath: string | null;
	skillsDir: string | null;
	writeModelConfig: ((value: ModelControlValue) => Promise<void>) | null;
	installSkill: ((value: InstallSkillControlValue) => Promise<void>) | null;
};
