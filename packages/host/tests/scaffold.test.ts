import { describe, expect, it } from "vitest";
import { VERSION } from "../src/index.js";

describe("@sumeru/host — package surface", () => {
	it("exposes VERSION at 0.3.2", () => {
		expect(VERSION).toBe("0.3.2");
	});
});
