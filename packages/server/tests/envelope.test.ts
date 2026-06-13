import { describe, expect, it } from "vitest";
import {
	envelope,
	errorEnvelope,
	gatewayEnvelope,
	gatewayListEnvelope,
	instanceEnvelope,
} from "../src/index.js";

describe("envelope helpers", () => {
	it("envelope() wraps any value with the given type", () => {
		expect(envelope("@example/x", { a: 1 })).toEqual({
			type: "@example/x",
			value: { a: 1 },
		});
	});

	it("instanceEnvelope() emits the @sumeru/instance type", () => {
		const e = instanceEnvelope({
			name: "sumeru",
			version: "0.1.0",
			gateways: [],
		});
		expect(e.type).toBe("@sumeru/instance");
		expect(e.value.gateways).toEqual([]);
	});

	it("gatewayListEnvelope() emits the @sumeru/gateway-list type", () => {
		const e = gatewayListEnvelope([]);
		expect(e.type).toBe("@sumeru/gateway-list");
		expect(e.value).toEqual([]);
	});

	it("gatewayEnvelope() emits the @sumeru/gateway type", () => {
		const e = gatewayEnvelope({
			name: "hermes",
			adapter: "hermes",
			status: "ready",
			activeSessions: 0,
			capabilities: { resume: true, streaming: true },
		});
		expect(e.type).toBe("@sumeru/gateway");
		expect(e.value.name).toBe("hermes");
	});

	it("errorEnvelope() emits the @sumeru/error type with error+message", () => {
		const e = errorEnvelope("not_found", "missing");
		expect(e).toEqual({
			type: "@sumeru/error",
			value: { error: "not_found", message: "missing" },
		});
	});
});
