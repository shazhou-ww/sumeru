import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index.js";

describe("@sumeru/host — package scaffold", () => {
	it("exposes a named VERSION export at 0.1.0", () => {
		expect(VERSION).toBe("0.1.0");
	});
});
