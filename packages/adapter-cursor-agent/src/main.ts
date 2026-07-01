#!/usr/bin/env node
import { createAdapterEntry } from "@sumeru/adapter-core";
import { createCursorAgentAdapter } from "./adapter.js";

createAdapterEntry(createCursorAgentAdapter());
