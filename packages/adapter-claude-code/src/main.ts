#!/usr/bin/env node
import { createSubcommandEntry } from "@sumeru/adapter-core";
import { createClaudeCodeAdapter } from "./adapter.js";
import { claudeCodeHarness } from "./harness.js";
import { manifest } from "./manifest.js";

createSubcommandEntry({
	impl: createClaudeCodeAdapter(),
	harness: claudeCodeHarness,
	manifest,
});
