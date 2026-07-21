#!/usr/bin/env node
import { createSubcommandEntry } from "@sumeru/adapter-core";
import { createCodexAdapter } from "./adapter.js";
import { codexHarness } from "./harness.js";
import { manifest } from "./manifest.js";

createSubcommandEntry({
	impl: createCodexAdapter(),
	harness: codexHarness,
	manifest,
});
