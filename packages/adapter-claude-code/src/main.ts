#!/usr/bin/env node
import { createAdapterEntry } from "@sumeru/adapter-core";
import { createClaudeCodeAdapter } from "./adapter.js";

createAdapterEntry(createClaudeCodeAdapter());
