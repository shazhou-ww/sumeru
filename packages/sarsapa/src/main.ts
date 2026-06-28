#!/usr/bin/env node
import { createAdapterEntry } from "@sumeru/adapter-core";
import { createSarsapaAdapter } from "./agent.js";

createAdapterEntry(createSarsapaAdapter());
