#!/usr/bin/env node
import { createAdapterEntry } from "@sumeru/adapter-core";
import { createCodexAdapter } from "./adapter.js";

createAdapterEntry(createCodexAdapter());
