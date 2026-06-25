import { describe, expect, test } from "vitest";
import { z } from "zod";

import { createCLI, ocasRenderPlugin } from "./index.js";

function createBuffers() {
  let stdout = "";
  let stderr = "";
  return {
    out: {
      stdout: { write: (text: string) => (stdout += text) },
      stderr: { write: (text: string) => (stderr += text) },
    },
    read: () => ({ stdout, stderr }),
  };
}

describe("error envelope and render plugin", () => {
  test("ctx.error emits @<cli>/error and exits non-zero", async () => {
    const cli = createCLI({ name: "ocas", version: "1.0.0" });
    cli
      .command("boom")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .action(async (_args, _flags, ctx) => ctx.error("msg", "E_CODE"));

    const io = createBuffers();
    const code = await cli.run({ argv: ["boom"], ...io.out });

    expect(code).toBe(1);
    const err = JSON.parse(io.read().stderr.trim());
    expect(err).toEqual({
      type: "@ocas/error",
      value: { message: "msg", code: "E_CODE", command: "boom" },
    });
  });

  test("thrown exceptions are normalized into error envelope", async () => {
    const cli = createCLI({ name: "ocas", version: "1.0.0" });
    cli
      .command("explode")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .action(async () => {
        throw new Error("kaboom");
      });

    const io = createBuffers();
    const code = await cli.run({ argv: ["explode"], ...io.out });

    expect(code).toBe(1);
    const err = JSON.parse(io.read().stderr.trim());
    expect(err.type).toBe("@ocas/error");
    expect(err.value.message).toContain("kaboom");
    expect(err.value.command).toBe("explode");
  });

  test("render flag is gated by render plugin", async () => {
    const withoutPlugin = createCLI({ name: "ocas", version: "1.0.0" });
    withoutPlugin
      .command("noop")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .action(async () => ({ ok: true }));

    expect(withoutPlugin.help()).not.toContain("--render");
    const io1 = createBuffers();
    const code1 = await withoutPlugin.run({ argv: ["noop", "--render"], ...io1.out });
    expect(code1).toBe(1);
    expect(io1.read().stderr).toContain("Unknown option");

    const withPlugin = createCLI({
      name: "ocas",
      version: "1.0.0",
      plugins: [ocasRenderPlugin(() => ({ open: true }))],
    });
    let seenRenderFlag = false;
    withPlugin
      .command("noop")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .action(async (_args, flags) => {
        seenRenderFlag = flags.render === true;
        return { ok: true };
      });

    expect(withPlugin.help()).toContain("--render");
    const io2 = createBuffers();
    const code2 = await withPlugin.run({ argv: ["noop", "--render"], ...io2.out });
    expect(code2).toBe(0);
    expect(seenRenderFlag).toBe(true);
  });
});
