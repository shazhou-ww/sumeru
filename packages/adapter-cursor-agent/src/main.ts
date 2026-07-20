#!/usr/bin/env node
import { createSubcommandEntry } from "@sumeru/adapter-core";
import { createCursorAgentAdapter } from "./adapter.js";
import { cursorAgentHarness } from "./harness.js";
import { manifest } from "./manifest.js";

createSubcommandEntry({
	impl: createCursorAgentAdapter(),
	harness: cursorAgentHarness,
	manifest,
});
