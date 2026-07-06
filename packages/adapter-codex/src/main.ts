#!/usr/bin/env node
import { createSessionLoop } from "@sumeru/adapter-core";
import { createCodexAdapter } from "./adapter.js";
import { codexHarness } from "./harness.js";

createSessionLoop(createCodexAdapter(), codexHarness);
