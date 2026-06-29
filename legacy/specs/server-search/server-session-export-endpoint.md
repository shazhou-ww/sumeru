---
scenario: "POST /gateways/:name/sessions/:id/export bundles a session's recording (session-meta + every turn + their schema chain) into a self-contained tar.gz via @ocas/core's exportBundle, returned as the response body"
feature: server-http
tags: [http, export, ocas, bundle, tar, gzip, recording, phase-5]
---

## Given
- Phase-4 session-meta and turn recording is in place (`server-ocas-session-meta.md`, `server-ocas-turn-recording.md`).
- `@ocas/core` exposes `exportBundle(store, roots, outputPath)` (see `packages/core/src/bundle.ts`):
  - Takes a list of "root" hashes (or variable names),
  - Computes the transitive CAS closure (all `ocas_ref` edges + the schema chain),
  - Writes a tar archive to `outputPath` containing:
    - `cas/<hash>.bin` — one CBOR-encoded file per node in the closure
    - `vars.jsonl` — every variable whose value is in the closure
    - `tags.jsonl` — every tag whose target is in the closure
  - Returns `{ nodes, vars, tags }` counts.
- The architecture spec (`specs/architecture.md` → "导出 Session Recording") declares:
  > 将 session 的完整 recording 导出为 ocas export 包（`.tar.gz`）。包内含所有关联的 ocas 对象，自包含，可直接用 ocas 工具分析。
  > 响应 200，Content-Type: application/gzip，body 是 tar.gz 文件。
- Session `ses_<X>` exists on gateway `hermes` and has been used:
  - 1 session-meta node (hash `M`) — written on create
  - 6 turn nodes (hashes `t1` through `t6`) — written across two `POST .../messages` exchanges
  - The two registered schemas are present (`@sumeru/session-meta`, `@sumeru/turn`) plus the meta-schema (`@ocas/schema`) — pulled in by `exportBundle`'s closure walker via each turn's / meta's `node.type` reference.
- The route `POST /gateways/:name/sessions/:id/export` is **new** to Phase 5. The path is reserved and unused before Phase 5.
- A new module `packages/server/src/export/index.ts` (with `types.ts` if shared types are needed) owns the export handler; the handler is wired into `createHandler` next to the other session-scoped routes.

## When
- The client issues each of the following:
  1. `curl -fsS -i -X POST -o /tmp/export.tar.gz http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<X>/export`
  2. `curl -fsS -i -X POST 'http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<X>/export?download=1' -o /tmp/export.tar.gz`
  3. `curl -fsS -i -X POST http://127.0.0.1:<port>/gateways/hermes/sessions/ses_DOES_NOT_EXIST/export`
  4. `curl -fsS -i -X POST http://127.0.0.1:<port>/gateways/does-not-exist/sessions/ses_<X>/export`
  5. `curl -sS  -i      http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<X>/export`            # GET disallowed
  6. `curl -sS  -i -X PUT http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<X>/export`
  7. `curl -fsS -i -X POST http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<CLOSED>/export`     # closed session
  8. `curl -fsS -i -X POST http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<EMPTY>/export`      # session with 0 turns
  9. `curl -fsS -i -X POST -H 'Accept-Encoding: gzip' http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<X>/export`
  10. `curl -fsS -i -X POST 'http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<X>/export/'`       # trailing slash
  11. `curl -fsS -i -X POST http://127.0.0.1:<port>/gateways/hermes/sessions/ses_<X>/export -H 'Content-Type: application/json' -d '{"foo":"bar"}'`  # body is ignored

## Then
- **Request 1 — happy path** —
  - HTTP `200 OK` (NOT 201 — export is a read, not a creation).
  - **Headers** (exact set, in any order):
    - `Content-Type: application/gzip`
    - `Content-Disposition: attachment; filename="<sessionId>.tar.gz"` — e.g. `attachment; filename="ses_01JABCD…XYZ.tar.gz"`. The filename is exactly `<sessionId>.tar.gz`; no path traversal segments are possible because session IDs match `^ses_[0-9A-HJKMNP-TV-Z]{26}$`. Browsers and `curl -O` save the file with this name.
    - `Cache-Control: no-store`
    - `X-Sumeru-Export-Nodes: <int>` — the count of CAS nodes in the bundle (sanity-check header for tools).
    - `X-Sumeru-Export-Session: <sessionId>` — echo of the session id.
    - `Content-Length: <int>` — set by reading the temp file's size before piping. The server does NOT use `Transfer-Encoding: chunked`; the bundle is fully assembled before the response begins so a precise Content-Length is always returned.
    - NO `ETag` (the bundle is bit-stable for a given session AT a given turn count, but adding a turn would change it; the cost of computing a hash up front isn't worth it for Phase 5).
  - **Body** is the raw bytes of the tar.gz produced by:
    1. Compute the export roots: `roots = [session.metaHash, ...session.turnHashes]`. (Order matters for determinism; see "Determinism" below.)
    2. Create a temp directory under `os.tmpdir()/sumeru-export-<random>/` and a temp tar path inside it, e.g. `bundle.tar`.
    3. Call `exportBundle(ocas.store, roots, bundleTarPath)` — this writes the tar to disk with all CAS nodes (`cas/<hash>.bin`), `vars.jsonl`, `tags.jsonl`.
    4. Read the tar, gzip-compress it with `node:zlib.gzipSync` at level 6 (default), write the result to `<bundleTarPath>.gz`.
    5. Set headers (above), then stream `<bundleTarPath>.gz` to the response via `createReadStream(...).pipe(res)`.
    6. After the response `finish` event, recursively `rm` the temp directory.
  - **Tar archive contents**, when `gunzip < /tmp/export.tar.gz | tar -t` is run:
    ```
    cas/<hash1>.bin
    cas/<hash2>.bin
    ...
    cas/<hashN>.bin
    vars.jsonl
    tags.jsonl
    ```
    - One `cas/*.bin` file per node in the closure. `N` = `1 (meta) + |session.turnHashes| + |schema-chain|`. For our fixture (1 meta + 6 turns + 3 schema nodes — `@sumeru/session-meta`, `@sumeru/turn`, `@ocas/schema`), `N = 10`. (The schema-of-schemas may self-reference, in which case the closure includes a single self-referential node — `exportBundle` already handles this.)
    - `vars.jsonl` exists even when no variables point into the closure — it is then empty (zero bytes OR a single newline; `exportBundle` emits empty content for empty input). Sumeru does not write any variables for sessions in Phase 5, so `vars.jsonl` is empty for every export.
    - `tags.jsonl` exists, also empty (Sumeru does not tag session nodes).
  - **Self-containment** — Re-importing the bundle into a fresh ocas dir reproduces the recording:
    ```typescript
    import { importBundle, createMemoryStore } from "@ocas/core";
    const target = createMemoryStore();
    await importBundle("/tmp/export.tar.gz.uncompressed.tar", target);
    // Every original hash is now present in `target`:
    target.cas.has(metaHash)         // true
    target.cas.has(turnHashes[0])    // true
    // ... etc.
    ```
    A test asserts every original hash is `has(...)` true after import, AND the decoded payload is byte-equal to the original (ocas's content addressing makes this automatic; the test is a regression guard).
  - **Determinism** — Two consecutive exports of the same session produce **byte-identical tar contents** (BEFORE gzip — gzip's compression is deterministic given the same input + level + version, but Node's gzip header includes a default mtime of 0 since Node 22, so the gzipped bytes are also stable across runs on the same Node minor version). Tests assert tar-level byte-equality (decompress both, then `Buffer.equals`). The order of `cas/*.bin` entries is the alphabetical sort of hashes — `exportBundle` already sorts deterministically.
- **Request 2 — `?download=1`** — Identical body, identical headers, EXCEPT `Content-Disposition: attachment; filename="<sessionId>.tar.gz"` (always set on POST regardless of `?download=`). The query param is accepted and silently ignored — reserved for future preview/inline modes.
- **Request 3 — unknown session** —
  - HTTP `404 Not Found`, `Content-Type: application/json; charset=utf-8`, body:
    ```json
    {
      "type": "@sumeru/error",
      "value": {
        "error": "session_not_found",
        "message": "Session ses_DOES_NOT_EXIST not found on gateway hermes"
      }
    }
    ```
  - The 404 is decided BEFORE any tar generation (no temp file is created). Tests count files under `os.tmpdir()` before and after to assert no leakage.
- **Request 4 — unknown gateway** — HTTP `404`, `value.error: "gateway_not_found"`, message `"Gateway does-not-exist not found"`. Same wording as Phase-2.
- **Request 5 — `GET`** — HTTP `405 Method Not Allowed`, `Allow: POST`, `@sumeru/error` envelope.
- **Request 6 — `PUT`** — HTTP `405`, `Allow: POST`, same envelope.
- **Request 7 — closed session** — HTTP `200`, body is the tar.gz of the recording UP TO the close. Closed sessions are exportable because their recording is preserved in ocas (see Architecture's "关闭后消息历史仍可读取"). The test fixture closes session A after 2 sends, then exports — the tar contains exactly those turns plus the meta.
- **Request 8 — empty session (0 turns)** — HTTP `200`, body is a tar.gz containing **only** the session-meta + schema chain (no `cas/<turn-hash>.bin` files). Counts: `N = 1 (meta) + 2 schemas + 1 meta-schema = 4`. The `X-Sumeru-Export-Nodes: 4` header reflects this. Tests assert that decompressing and listing entries shows no turn nodes.
- **Request 9 — `Accept-Encoding: gzip`** — HTTP `200`. The server does NOT honor `Accept-Encoding` for transparent gzipping — the body is **already** gzipped. Setting `Content-Encoding: gzip` would mean the client should auto-decompress, but the user expects to download a `.tar.gz` file, not a tar. Therefore: `Content-Type: application/gzip` AND **no** `Content-Encoding` header (the gzip is the payload format, not a transport encoding). This is the same convention used by GitHub's release tarballs. Tests assert `res.headers["content-encoding"]` is `undefined`.
- **Request 10 — trailing slash** — HTTP `200`, body identical to Request 1. Trailing slash normalized.
- **Request 11 — request body** — HTTP `200`, body identical to Request 1. The export endpoint reads NO request body. The `Content-Length`/`Transfer-Encoding` of the request is consumed and discarded so keep-alive works correctly.
- **Concurrency / status flips** — `POST .../export` does NOT call `tryActivate` / `markIdle`. Multiple concurrent exports of the same session are allowed (export is read-only). A concurrent `POST .../messages` writing turn N+1 races: the export captures whatever `Session.turnHashes` was at the moment the handler read it. (No tearing — `turnHashes` is appended to atomically; a slice is a snapshot.)
- **Adapter independence** — The export is built entirely from ocas; the adapter is NEVER called. Tests assert this with a stub adapter that throws on every method except `createSession`/`send` (the methods used to set up the fixture).
- **Filesystem / cleanup** —
  - Temp dirs use `mkdtempSync(join(os.tmpdir(), "sumeru-export-"))` so concurrent exports don't collide.
  - The temp dir is removed after the response's `finish` event fires (the server's stream pipe `await`s `finish`, then `rm({ recursive: true, force: true })`s the dir).
  - On client disconnect mid-stream, the response emits `close` without `finish`. The handler treats both via a `once("close", cleanup)` so the temp dir is always removed within ~100 ms of disconnect. Tests assert no leaked temp dirs after 100 disconnect-mid-stream iterations.
  - On `exportBundle` errors (e.g. closure walker fails — should not happen with valid hashes, but defensive): HTTP `500 export_failed`, `value.message: "Failed to build session export: <cause-truncated-to-500>"`. Temp dir is cleaned up before the response is sent.
- **Size limits** —
  - The export is fully materialized in a temp file; no in-memory buffering of the tar. So a 1 GB session export uses 2× disk (uncompressed tar + .gz) but bounded RAM.
  - A soft cap: if the closure has more than 100,000 nodes, the server still serves the export but logs a warning `[sumeru] large export: <sessionId> nodes=<N>`. No 413; rejecting on size would surprise users who legitimately accumulate long sessions. Tests do NOT exercise the 100k path (would require 100k+ inserts) but the warn log call site is unit-tested with a mocked `exportBundle` returning `{ nodes: 100001, vars: 0, tags: 0 }`.
- **Symlinks / path traversal** — `exportBundle` writes `cas/<hash>.bin` where `<hash>` matches `^[0-9A-HJKMNP-TV-Z]{13}$` — no traversal possible. The bundle's tar is read raw from disk; the server never re-packs entry names from user input.
- **`HEAD`** — `HEAD .../export` returns `200`, the same headers as `POST` (including a freshly-computed `Content-Length`, `X-Sumeru-Export-*`), and an empty body. The implementation reuses the POST path but discards the body before piping. Tests assert `Content-Length` matches what a parallel POST returns.
- **Idempotency** — POST is idempotent for export: two POSTs return identical tar.gz bytes (modulo the gzip-time mtime question — see Determinism). Tests run two POSTs and assert tar-level byte-equality.
- **Tests** under `packages/server/tests/export-endpoint.test.ts`:
  - **Happy path** — Fixture: create session, send 2 messages producing 6 turns total. POST `.../export`, assert HTTP 200, headers (Content-Type, Content-Disposition, X-Sumeru-Export-Nodes, X-Sumeru-Export-Session, Content-Length matches body length).
  - **Tar contents** — Decompress with `gunzipSync`, parse the tar with a tiny tar-reader (or `tar` package — already a transitive dep of pnpm? add only if needed). Assert entry names: `cas/<hash>.bin` for each of the 1 + 6 + 3 = 10 hashes (sorted), then `vars.jsonl`, then `tags.jsonl`.
  - **Re-import round-trip** — Decompress + un-tar to a temp dir, then `importBundle(<tar-path>, target=createMemoryStore())`. Assert every original hash `has(...)` true and `cas.get(hash).payload` byte-equal to the original.
  - **Determinism** — Two consecutive POSTs to the same session, decompress and tar-decode both, assert the entry list and per-entry bytes are equal.
  - **Closed session** — Close session, then POST export. Assert 200 + meta + 6 turns present (close doesn't strip turns).
  - **Empty session (0 turns)** — POST export immediately after create (no sends). Assert `X-Sumeru-Export-Nodes: 4` (1 meta + 3 schemas — `@sumeru/session-meta`, `@sumeru/turn`, `@ocas/schema`), tar contains only those 4 `cas/*.bin` files.
  - **Concurrent exports of same session** — 5 parallel POSTs; all return 200; all bodies are byte-identical. No temp-dir leaks (count tmp dirs after).
  - **Concurrent export + send** — While a `POST .../messages` is mid-stream, issue `POST .../export`. Both succeed. The export contains the turns committed AT THE TIME the handler read `turnHashes`; subsequent turns are NOT in the tar. Test asserts the export's tar contains either N or N+M turns where N was pre-export and M is the in-flight count, and is internally consistent.
  - **Unknown session / gateway / wrong method** — Requests 3-6 each have status + envelope asserted exactly.
  - **Cleanup on disconnect** — Open the connection, abort after 1 KB read, wait 200 ms, count tmp dirs under `<tmp>/sumeru-export-*` — should be 0.
  - **Body ignored** — POST with arbitrary JSON body returns same bytes as POST with empty body.
  - **HEAD** — Empty body, headers match POST's headers (including `Content-Length`).
  - **`Content-Encoding` absent** — Assert `res.headers["content-encoding"] === undefined` even when `Accept-Encoding: gzip` is set.
  - **No adapter calls** — Stub adapter throws on `getTurns`/`close`/`send`; export still succeeds (only ocas is read).
  - **`X-Sumeru-Export-Nodes` header** — Decompress the tar and count `cas/*.bin` entries; assert it equals the header value.
  - **Filename safety** — Assert `Content-Disposition` exactly matches `attachment; filename="ses_<26 chars>.tar.gz"`.
- **Documentation** —
  - `README.md`'s HTTP table gains a row: `POST /gateways/:name/sessions/:id/export` → `tar.gz (application/gzip)`.
  - `README.md` Recording section gets a one-line note: "Sessions can be exported as self-contained ocas bundles via `POST .../export` (`tar.gz`); use `ocas import <file>` to load into another store."
- **Non-goals (Phase 5)** —
  - **No streaming archive** (the temp-file approach is simpler and bounded; a streaming tar+gzip pipeline is a Phase-6+ concern).
  - **No bulk export** (no `POST /gateways/:name/sessions/export` for ALL sessions — out of scope).
  - **No partial exports** (no `?from=index&to=index` to slice turn ranges — the whole recording is exported).
  - **No signing / encryption** — bundles are plain gzip+tar, trust comes from ocas's content addressing.
  - **No `import` HTTP endpoint** — import remains an `ocas` CLI / `@ocas/core` API operation.
- All Phase-1/2/3/4 tests continue to pass unchanged.
- `pnpm run build`, `pnpm run check`, and `pnpm run test` all exit 0. No new top-level dependencies are added (`node:zlib`, `node:fs`, `node:os`, `node:path` are all built in; `exportBundle` and the tar primitives ship with `@ocas/core`).
