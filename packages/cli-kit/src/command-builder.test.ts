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

describe("command builder", () => {
  test("parses args/flags and validates yields/returns", async () => {
    const seen: { args?: Record<string, string>; flags?: Record<string, unknown> } = {};
    const cli = createCLI({ name: "gangmu", version: "1.0.0" });

    cli
      .command("search")
      .arg("query")
      .flag("limit", { type: "number", default: 5 })
      .yields(
        z.object({ card: z.string(), score: z.number() }),
        "{{card}}:{{score}}",
      )
      .returns(
        z.object({ query: z.string(), count: z.number() }),
        "{{query}} {{count}}",
      )
      .action(async function* (args, flags) {
        seen.args = args;
        seen.flags = flags;
        yield { card: "alpha", score: 0.9 };
        return { query: args.query, count: Number(flags.limit) };
      });

    const io = createBuffers();
    const code = await cli.run({
      argv: ["search", "needle", "--limit", "2", "--format", "json", "--compact"],
      ...io.out,
    });

    const { stdout, stderr } = io.read();
    expect(code).toBe(0);
    expect(seen.args).toEqual({ query: "needle" });
    expect(seen.flags).toMatchObject({
      limit: 2,
      format: "json",
      compact: true,
      quiet: false,
    });

    expect(JSON.parse(stderr.trim())).toEqual({
      type: "@gangmu/search/yield",
      value: { card: "alpha", score: 0.9 },
    });

    expect(stdout).toBe(
      '{"type":"@gangmu/search","value":{"query":"needle","count":2}}\n',
    );
  });

  test("requires returns schema for executable leaf command", async () => {
    const cli = createCLI({ name: "gangmu", version: "1.0.0" });
    cli.command("leaf").action(async () => ({ ok: true }));

    const io = createBuffers();
    const code = await cli.run({ argv: ["leaf"], ...io.out });
    const err = JSON.parse(io.read().stderr.trim());

    expect(code).toBe(1);
    expect(err.type).toBe("@gangmu/error");
    expect(err.value.message).toContain("returns");
  });

  test("group command is not directly executable", async () => {
    const cli = createCLI({ name: "gangmu", version: "1.0.0" });
    cli
      .command("group")
      .command("child")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .action(async () => ({ ok: true }));

    const io = createBuffers();
    const code = await cli.run({ argv: ["group"], ...io.out });
    const err = JSON.parse(io.read().stderr.trim());

    expect(code).toBe(1);
    expect(err.type).toBe("@gangmu/error");
    expect(err.value.message).toContain("not executable");
  });
});
