import type { HarnessConfig } from "@sumeru/adapter-core";
import { DEFAULT_SESSION_PATH } from "./session-store.js";

export const sarsapaHarness: HarnessConfig = {
	resetPaths: [DEFAULT_SESSION_PATH],
	modelConfigPath: null,
	personaPath: null,
	skillsDir: null,
	writeModelConfig: null,
	installSkill: null,
};
