#!/usr/bin/env node
import { createSubcommandEntry } from "@sumeru/adapter-core";
import { createHermesAdapter } from "./adapter.js";
import { hermesHarness } from "./harness.js";
import { manifest } from "./manifest.js";

const profile =
	typeof process.env.SUMERU_HERMES_PROFILE === "string" &&
	process.env.SUMERU_HERMES_PROFILE.length > 0
		? process.env.SUMERU_HERMES_PROFILE
		: "default";

createSubcommandEntry({
	impl: createHermesAdapter({ profile }),
	harness: hermesHarness,
	manifest,
});
