import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installUnhandledRejectionGuard } from "../src/process-guards.js";

describe("installUnhandledRejectionGuard", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("registers exactly one unhandledRejection listener on the target", () => {
		const target = new EventEmitter();
		const uninstall = installUnhandledRejectionGuard({ target, log: () => {} });

		expect(target.listenerCount("unhandledRejection")).toBe(1);

		uninstall();
		expect(target.listenerCount("unhandledRejection")).toBe(0);
	});

	it("logs the rejection reason but never calls process.exit", () => {
		const target = new EventEmitter();
		const log = vi.fn();
		const exitSpy = vi
			.spyOn(process, "exit")
			.mockImplementation(
				((): never => undefined as never) as typeof process.exit,
			);
		const uninstall = installUnhandledRejectionGuard({ target, log });

		const reason = new Error("background task blew up");
		target.emit("unhandledRejection", reason);

		expect(log).toHaveBeenCalledTimes(1);
		expect(log).toHaveBeenCalledWith("[host] unhandledRejection", reason);
		expect(exitSpy).not.toHaveBeenCalled();

		uninstall();
	});

	it("stays armed across multiple rejections (last line of defense)", () => {
		const target = new EventEmitter();
		const log = vi.fn();
		const uninstall = installUnhandledRejectionGuard({ target, log });

		target.emit("unhandledRejection", new Error("one"));
		target.emit("unhandledRejection", new Error("two"));
		target.emit("unhandledRejection", "three");

		expect(log).toHaveBeenCalledTimes(3);

		uninstall();
	});

	it("defaults to the real process emitter and is fully removable", () => {
		const before = process.listenerCount("unhandledRejection");
		const uninstall = installUnhandledRejectionGuard({ log: () => {} });

		expect(process.listenerCount("unhandledRejection")).toBe(before + 1);

		uninstall();
		expect(process.listenerCount("unhandledRejection")).toBe(before);
	});

	it("defaults to structured logger when no log option is provided", async () => {
		const loggerMod = await import("../src/logger.js");
		const errorSpy = vi
			.spyOn(loggerMod.logger, "error")
			.mockImplementation(() => {});
		const target = new EventEmitter();
		const uninstall = installUnhandledRejectionGuard({ target });

		const reason = new Error("boom");
		target.emit("unhandledRejection", reason);

		expect(errorSpy).toHaveBeenCalledWith(
			"SMRGRP00",
			expect.stringContaining("unhandledRejection"),
		);

		uninstall();
		errorSpy.mockRestore();
	});
});
