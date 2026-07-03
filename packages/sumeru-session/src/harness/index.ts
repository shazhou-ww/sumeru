import type { DetectedAdapter } from "../detect.js";
import { claudeCodeHarness } from "./claude-code.js";
import { codexHarness } from "./codex.js";
import { cursorAgentHarness } from "./cursor-agent.js";
import { hermesHarness } from "./hermes.js";
import { sarsapaHarness } from "./sarsapa.js";
import type { HarnessConfig } from "./types.js";

const HARNESS_BY_ADAPTER: Record<DetectedAdapter, HarnessConfig> = {
	sarsapa: sarsapaHarness,
	hermes: hermesHarness,
	"claude-code": claudeCodeHarness,
	"cursor-agent": cursorAgentHarness,
	codex: codexHarness,
};

export function getHarnessConfig(adapter: DetectedAdapter): HarnessConfig {
	return HARNESS_BY_ADAPTER[adapter];
}

export type { HarnessConfig } from "./types.js";
