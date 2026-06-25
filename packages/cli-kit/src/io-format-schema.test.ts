import { describe, expect, test } from "vitest";
import { z } from "zod";

import { createCLI } from "./index.js";

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

describe("io channels and schema naming", () => {
  function buildCli() {
    const cli = createCLI({ name: "ocas", version: "1.0.0" });
    cli
      .command("var")
      .command("set")
      .arg("query")
      .yields(z.object({ step: z.string() }), "step={{step}}")
      .returns(z.object({ query: z.string(), count: z.number() }), "Q={{query}}", {
        name: "@custom/result",
      })
      .action(async function* (args) {
        yield { step: "begin" };
        return { query: args.query, count: 1 };
      });
    return cli;
  }

  test("writes yields to stderr and returns to stdout", async () => {
    const io = createBuffers();
    const code = await buildCli().run({
      argv: ["var", "set", "x", "--format", "json", "--compact"],
      ...io.out,
    });
    const { stdout, stderr } = io.read();

    expect(code).toBe(0);
    expect(JSON.parse(stderr.trim())).toEqual({
      type: "@ocas/var/set/yield",
      value: { step: "begin" },
    });
    expect(stdout).toBe(
      '{"type":"@custom/result","value":{"query":"x","count":1}}\n',
    );
  });

  test("respects --quiet and format switches", async () => {
    const yamlIo = createBuffers();
    await buildCli().run({ argv: ["var", "set", "x"], ...yamlIo.out });
    expect(yamlIo.read().stdout).toContain("type: \"@custom/result\"");

    const textIo = createBuffers();
    await buildCli().run({
      argv: ["var", "set", "x", "--format", "text", "--quiet"],
      ...textIo.out,
    });
    expect(textIo.read().stdout.trim()).toBe("Q=x");
    expect(textIo.read().stderr).toBe("");

    const htmlIo = createBuffers();
    await buildCli().run({
      argv: ["var", "set", "x", "--format", "html", "--quiet"],
      ...htmlIo.out,
    });
    expect(htmlIo.read().stdout.trim()).toBe("Q=x");
  });

  test("default schema names when no override", async () => {
    const cli = createCLI({ name: "ocas", version: "1.0.0" });
    cli
      .command("var")
      .command("set")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .action(async () => ({ ok: true }));

    const io = createBuffers();
    await cli.run({ argv: ["var", "set", "--format", "json", "--compact"], ...io.out });
    expect(io.read().stdout).toContain('"type":"@ocas/var/set"');
  });
});
