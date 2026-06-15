---
"@sumeru/server": patch
---

fix: disable Nagle's algorithm on SSE responses so events flush immediately

Without `socket.setNoDelay(true)`, heartbeats, turn events, and done events
written via `res.write()` were buffered by the TCP stack and never reached the
client. This caused the broker's SSE consumer (`consumeSse`) to block
indefinitely on `reader.read()`, making the entire broker → Sumeru → agent
pipeline hang.

Fixes #30.
