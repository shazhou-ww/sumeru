#!/usr/bin/env node
import { createSessionLoop } from "@sumeru/adapter-core";
import { createCursorAgentAdapter } from "./adapter.js";
import { cursorAgentHarness } from "./harness.js";

createSessionLoop(createCursorAgentAdapter(), cursorAgentHarness);
