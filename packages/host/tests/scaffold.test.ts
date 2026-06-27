import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index.js";

describe("@sumeru/host — package surface", () => {
	it("exposes VERSION at 0.1.0", () => {
		expect(VERSION).toBe("0.1.0");
	});
});
