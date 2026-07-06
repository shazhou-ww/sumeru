#!/usr/bin/env node
import { createSessionLoop } from "@sumeru/adapter-core";
import { createSarsapaAdapter } from "./agent.js";
import { sarsapaHarness } from "./harness.js";

createSessionLoop(createSarsapaAdapter(), sarsapaHarness);
