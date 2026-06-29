---
scenario: "README.md's 部署 chapter gains a 「Docker 模式」 subsection (3–6 lines of prose + a config snippet) documenting the zero-source-tree path — `pnpm add -g @sumeru/cli` → write a `deploy.mode: docker` config → `sumeru start -c <config>` — and pinning the two operator-facing guarantees (ocas lands on a named volume so `down` keeps data and only `down -v` clears it; one config = one work unit). Phase 2's stale 'launch comes in a later phase' note is removed because `sumeru start` now launches. Links back to specs/architecture/docker-mode.md."
feature: docs
tags: [docs, readme, docker, deploy, volume, persistence, work-unit, phase-3, issue-86]
---

## Given

- The Sumeru repository has a root `README.md` whose `## 部署` chapter already documents the systemd user service (see `specs/deploy/deploy-readme-deployment-section.md`).
- Phase 1 (#84) added a `### Docker 模式` subsection to that chapter, but it ends with a now-stale forward-looking note:
  > **Phase 1（本期）** 落地 `deploy:` 块解析、随包发布的模板…；据 `deploy.mode: docker` 由 `sumeru start -c <config>` 一键拉起容器的统一入口在**后续阶段接入**。
  Phase 2 (#85) **shipped** that unified entry point (`sumeru start -c <config>` dispatches on `deploy.mode`, see `specs/cli/start-deploy-mode-dispatch.md`), so the "后续阶段接入" wording is no longer true and must be corrected by Phase 3.
- The design source of truth is `specs/architecture/docker-mode.md`; its "Documentation" block requires the README subsection to give the `pnpm add -g @sumeru/cli` → `deploy.mode: docker` config → `sumeru start -c <config>` path plus the two guarantees, and to link back to architecture.md + the docker-mode spec.
- The integration behaviors the README describes informally are locked by `specs/integration/docker-mode-integration.md`.
- The README is written in Chinese (headings + prose); this subsection matches that style.

## When

- A new operator reads `README.md`'s `## 部署` chapter looking for how to run Sumeru in Docker, having only `pnpm` and Docker installed (no Sumeru source checkout).

## Then

### Then-1: the subsection exists and teaches the zero-source-tree path

- `README.md` contains a `### Docker 模式` subsection inside the `## 部署` chapter.
- It is concise: **3–6 lines of prose** plus one short YAML config snippet (the existing `name` / `workspaceRoot` / `deploy:` / `gateways:` example is retained or lightly trimmed — it already shows `mode: docker`, `port`, `workspace`, optional `image`).
- It documents the **three-step, no-source path** explicitly:
  1. `pnpm add -g @sumeru/cli` — get the `sumeru` command from npm (no `git clone`, no local `pnpm run build`).
  2. Write a `sumeru.yaml` carrying a `deploy:` block with `mode: docker` (and `name` / `port` / `workspace`).
  3. `sumeru start -c <config>` — one command; the CLI reads `deploy.mode` and launches `docker compose -p <name> up -d --build` (no `--docker` flag).
- The prose states that the orchestration assets (`Dockerfile` / `docker-compose.yaml` / `sumeru.env.example`) ship with `@sumeru/server` and are materialized into the unit dir by the CLI (zero-render; all variability via compose-native `${VAR:-default}`), so the flow needs no source repository.

### Then-2: the two operator guarantees are stated verbatim-in-spirit

- **Persistence**: the subsection states that ocas data lands on a **named volume** `<name>_sumeru-ocas`, so `docker compose -p <name> down` (without `-v`) **keeps the data** and only `docker compose -p <name> down -v` clears it. (This is the user-visible payoff the integration persistence case asserts.)
- **Work-unit model**: the subsection states that **一份 config = 一个工作单元** — `name` is the unit identity (instance name / compose project / volume prefix), and multiple configs (`alpha.yaml` / `beta.yaml`) yield multiple mutually-isolated units (independent volume / port / session). No extra orchestration mechanism is needed; isolation comes from config identity.

### Then-3: the stale Phase-1 note is corrected, not left dangling

- The old "据 `deploy.mode: docker` 由 `sumeru start -c <config>` 一键拉起容器的统一入口在**后续阶段接入**" sentence is **removed or rewritten** to reflect that `sumeru start -c <config>` launches **now** (shipped in Phase 2). The README must not claim a shipped feature is still pending.
- If a phase/status note is kept, it reflects reality: parsing + templates + `materializeDockerAssets` (Phase 1) and the `deploy.mode` launch dispatch + `--emit-assets` + no-Docker downgrade (Phase 2) are all landed.

### Then-4: links resolve

- The subsection links back to the design spec at `specs/architecture/docker-mode.md` (the existing link is kept/retargeted). The link is a valid repo-relative path that resolves on Gitea's markdown renderer.
- The cross-reference to the architecture chapter ("部署模式 → Docker 模式") remains accurate.

### Then-5: scope, style, and gates

- The change is **documentation only** — no code, no template, no test change is bundled into this spec's deliverable (the test work is `specs/integration/docker-mode-integration.md`). Editing `README.md` does not affect `pnpm run build` / `pnpm run check` / `pnpm run test`, which stay exit `0`.
- Markdown renders cleanly: fenced ```yaml block closed, headings nested under `## 部署`, consistent with surrounding Chinese prose and the existing systemd subsections.
- Covered by the shared Phase-3 `@sumeru/cli` **patch** changeset (see `specs/integration/docker-mode-integration.md` Then-9); no separate bump. Conventional commit `Fixes #86`, author `小橘 <xiaoju@shazhou.work>`.

## Non-goals

- **No** full Docker tutorial / troubleshooting matrix — the subsection is a 3–6 line pointer; depth lives in `specs/architecture/docker-mode.md`.
- **No** duplication of the HTTP API table or the systemd content — only the Docker-mode addition.
- **No** new config keys or behavior documented beyond what Phase 1/2 shipped (`deploy.mode` / `port` / `workspace` / `image`).
- **No** English translation of the README (it stays Chinese, matching the rest of the file).
