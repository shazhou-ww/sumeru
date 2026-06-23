---
"@sumeru/cli": minor
---

Parse the optional top-level `deploy:` block of `sumeru.yaml` (issue #84,
Phase 1).

New CLI-side module `packages/cli/src/deploy-config.ts` exports
`loadDeployConfig(path): Promise<DeployConfig>`, where:

```typescript
type DeployConfig = {
  mode: "docker" | "local";  // absent → "local"
  port: number | null;       // host port; absent → null
  workspace: string | null;  // host workdir; absent / "" → null
  image: string | null;      // image tag; absent / "" → null
};
```

The parser is a pure structural reader: it stores `workspace` verbatim (no `~`
expansion), folds empty-string `workspace` / `image` to `null`, and does NOT
bake in the `7900` port or `sumeru:latest` image defaults — those belong to the
compose template's `${VAR:-default}` interpolation. Malformed input throws an
`Error` naming the offending field (`deploy.mode` / `deploy.port` / `deploy`),
the offending value, and the source path.

`@sumeru/server`'s `loadConfig` is unchanged — `deploy` remains an unknown
top-level key that the existing forward-compat tolerance silently ignores, so
the server runtime never sees deployment metadata.
