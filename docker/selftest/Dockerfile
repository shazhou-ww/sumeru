# syntax=docker/dockerfile:1
#
# Sumeru self-test prototype — hermes agent configured for regression testing.
# Mount ~/repos/sumeru at /workspace to test current code.
FROM sumeru/hermes:dev

USER root

# pnpm (needed for `pnpm install` / `vitest run`)
RUN corepack enable && corepack prepare pnpm@latest --activate

# tea CLI for Gitea issue operations
RUN curl -sL https://dl.gitea.com/tea/0.9.2/tea-0.9.2-linux-amd64 -o /usr/local/bin/tea \
    && chmod +x /usr/local/bin/tea

# sqlite3 for state.db inspection during E2E
RUN apt-get update -qq && apt-get install -y -qq sqlite3 && rm -rf /var/lib/apt/lists/*

USER node
WORKDIR /workspace

LABEL sumeru.harness="hermes"
LABEL sumeru.prototype="selftest"
LABEL sumeru.persona="selftest"
CMD ["sleep", "infinity"]
