---
"@sumeru/server": patch
---

Fix SSE resume returning 404 instead of 410 for expired buffers

When a client attempts to resume an SSE stream (via Last-Event-ID) after the
buffer retention window (30s), the server now returns `410 Gone` with error
`stream_expired` instead of `404` with `no_event_buffer`. This allows clients
to distinguish "the stream existed but expired" from "no stream was ever
created for this session".

Implementation adds a bounded ghost set to `SseBufferStore` that tracks
recently-expired session keys. The ghost set is pruned on each `purgeExpired`
call after `retentionMs`, preventing unbounded growth.

Fixes #58
