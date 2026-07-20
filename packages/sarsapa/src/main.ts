#!/usr/bin/env node
import { createSubcommandEntry } from "@sumeru/adapter-core";
import { createSarsapaAdapter } from "./agent.js";
import { sarsapaHarness } from "./harness.js";
import { manifest } from "./manifest.js";

createSubcommandEntry({
	impl: createSarsapaAdapter(),
	harness: sarsapaHarness,
	manifest,
});
