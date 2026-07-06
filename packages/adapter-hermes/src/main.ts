#!/usr/bin/env node
import { createSessionLoop } from "@sumeru/adapter-core";
import { createHermesAdapter } from "./adapter.js";
import { hermesHarness } from "./harness.js";

const profile =
	typeof process.env.SUMERU_HERMES_PROFILE === "string" &&
	process.env.SUMERU_HERMES_PROFILE.length > 0
		? process.env.SUMERU_HERMES_PROFILE
		: "default";

createSessionLoop(createHermesAdapter({ profile }), hermesHarness);
