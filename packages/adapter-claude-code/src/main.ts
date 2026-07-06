#!/usr/bin/env node
import { createSessionLoop } from "@sumeru/adapter-core";
import { createClaudeCodeAdapter } from "./adapter.js";
import { claudeCodeHarness } from "./harness.js";

createSessionLoop(createClaudeCodeAdapter(), claudeCodeHarness);
