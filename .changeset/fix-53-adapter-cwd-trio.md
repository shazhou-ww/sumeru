---
"@sumeru/adapter-hermes": minor
"@sumeru/adapter-claude-code": patch
---

Resolve per-call `config.cwd` consistently across both adapters (#53 #54 #66).

Both `createHermesAdapter` and `createClaudeCodeAdapter` now apply one
byte-identical 5-case cwd policy in `createSession`:

1. a non-empty per-call `config.cwd` wins;
2. else the constructor `cwd`;
3. else `process.cwd()`;
4. a non-null, non-string `config.cwd` is rejected with an `Error`
   (`"config.cwd must be a string"`) before any process is spawned;
5. an empty-string `config.cwd` is treated as absent.

The resolved value is used for BOTH the spawned process's working directory
and `ref.meta.cwd`, so they can never diverge. cwd travels solely via
`child_process.spawn`'s `cwd` option — there is no `--cwd` CLI flag.

- adapter-hermes: adds a `cwd: string | null` constructor option, a required
  `cwd` field on `SpawnArgs`, and forwards it through `defaultSpawn`. `send`
  now pins the resume spawn to `ref.meta.cwd` (falling back to the resolved
  default for legacy hand-built refs), fixing #66 where resumes inherited the
  server's `process.cwd()`.
- adapter-claude-code: adds the Case-4 non-string rejection (#54); the
  existing per-call/constructor/`process.cwd()` resolution is unchanged.
