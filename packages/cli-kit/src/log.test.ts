import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";
import { z } from "zod";

import { assertValidLogTag, createCLI } from "./index.js";

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

describe("log tag and jsonl logging", () => {
  test("assertValidLogTag validates Crockford Base32 tags", () => {
    expect(() => assertValidLogTag("1A2B3C4D")).not.toThrow();
    expect(() => assertValidLogTag("not-tag")).toThrow();
  });

  test("ctx.log writes JSONL records with required fields", async () => {
    const home = mkdtempSync(join(tmpdir(), "cli-kit-log-"));
    const cli = createCLI({ name: "ocas", version: "1.0.0", homeDir: home });

    cli
      .command("do")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .action(async (_args, _flags, ctx) => {
        ctx.log.debug("ABCDEFGH", "first");
        ctx.log.info("1234ABCD", "second");
        ctx.log.warn("ZZZZZZZZ", "third");
        return { ok: true };
      });

    const io = createBuffers();
    const code = await cli.run({ argv: ["do", "--quiet"], ...io.out });

    expect(code).toBe(0);

    const day = new Date().toISOString().slice(0, 10);
    const logPath = join(home, ".ocas", "logs", `${day}.jsonl`);
    const rows = readFileSync(logPath, "utf-8").trim().split("\n");
    expect(rows).toHaveLength(3);

    for (const row of rows) {
      const record = JSON.parse(row) as Record<string, unknown>;
      expect(typeof record.ts).toBe("string");
      expect(typeof record.pid).toBe("number");
      expect(typeof record.tag).toBe("string");
      expect(typeof record.msg).toBe("string");
    }
  });

  test("invalid log tag fails and prevents malformed write", async () => {
    const home = mkdtempSync(join(tmpdir(), "cli-kit-log-bad-"));
    const cli = createCLI({ name: "ocas", version: "1.0.0", homeDir: home });

    cli
      .command("do")
      .returns(z.object({ ok: z.boolean() }), "{{ok}}")
      .action(async (_args, _flags, ctx) => {
        ctx.log.info("bad", "nope");
        return { ok: true };
      });

    const io = createBuffers();
    const code = await cli.run({ argv: ["do"], ...io.out });

    expect(code).toBe(1);
    expect(io.read().stderr).toContain("invalid log tag");
  });
});
