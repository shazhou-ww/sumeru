import { describe, expect, it } from "vitest";
import { parseEnvFlagsFromArgv, parseEnvPair } from "../src/env-flags.js";

describe("parseEnvPair", () => {
	it("parses KEY=VALUE", () => {
		expect(parseEnvPair("CURSOR_API_KEY=crsr_xxx")).toEqual({
			key: "CURSOR_API_KEY",
			value: "crsr_xxx",
		});
	});

	it("preserves values containing equals signs", () => {
		expect(parseEnvPair("URL=https://x.com?a=b")).toEqual({
			key: "URL",
			value: "https://x.com?a=b",
		});
	});

	it("rejects values without equals sign", () => {
		expect(() => parseEnvPair("INVALID")).toThrow("KEY=VALUE");
	});
});

describe("parseEnvFlagsFromArgv", () => {
	it("returns null when no --env flags are present", () => {
		expect(
			parseEnvFlagsFromArgv([
				"session",
				"add",
				"cursor-agent",
				"--project",
				"/tmp",
				"--task",
				"do X",
			]),
		).toBeNull();
	});

	it("collects repeated --env flags", () => {
		expect(
			parseEnvFlagsFromArgv([
				"session",
				"add",
				"cursor-agent",
				"--project",
				"/tmp",
				"--task",
				"do X",
				"--env",
				"CURSOR_API_KEY=crsr_xxx",
				"--env",
				"OPENAI_API_KEY=sk-xxx",
			]),
		).toEqual({
			CURSOR_API_KEY: "crsr_xxx",
			OPENAI_API_KEY: "sk-xxx",
		});
	});

	it("supports inline --env=KEY=VALUE form", () => {
		expect(
			parseEnvFlagsFromArgv([
				"session",
				"add",
				"cursor-agent",
				"--env=FOO=bar",
			]),
		).toEqual({ FOO: "bar" });
	});

	it("later --env values override earlier ones for the same key", () => {
		expect(
			parseEnvFlagsFromArgv([
				"session",
				"add",
				"proto",
				"--env",
				"KEY=first",
				"--env",
				"KEY=second",
			]),
		).toEqual({ KEY: "second" });
	});

	it("throws when --env is missing a value", () => {
		expect(() =>
			parseEnvFlagsFromArgv(["session", "add", "proto", "--env"]),
		).toThrow("Missing value for --env");
	});
});
