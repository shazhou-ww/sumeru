#!/usr/bin/env node
import { createAdapterEntry } from "@sumeru/adapter-core";
import { createHermesAdapter } from "./adapter.js";

const profile =
	typeof process.env.SUMERU_HERMES_PROFILE === "string" &&
	process.env.SUMERU_HERMES_PROFILE.length > 0
		? process.env.SUMERU_HERMES_PROFILE
		: "default";

createAdapterEntry(createHermesAdapter({ profile }));
