# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Worker image.
#
# Build context is the repository root, because the worker depends on four
# workspace packages:
#   docker build -f apps/worker/Dockerfile .
#
# Chromium is installed from Debian rather than downloaded by Playwright: the
# distro build is patched, and it keeps the image from re-fetching ~150MB of
# browser on every rebuild.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9.12.3 --activate
WORKDIR /app

# --- Dependencies ----------------------------------------------------------
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY packages/shared/package.json  packages/shared/
COPY packages/db/package.json      packages/db/
COPY packages/ai/package.json      packages/ai/
COPY packages/pdf/package.json     packages/pdf/
COPY apps/worker/package.json      apps/worker/
# Playwright must not pull its own browser build; the image supplies one.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# --- Build -----------------------------------------------------------------
FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/ packages/
COPY apps/worker/ apps/worker/
RUN pnpm --filter=@fieldnote/shared build \
 && pnpm --filter=@fieldnote/db build \
 && pnpm --filter=@fieldnote/ai build \
 && pnpm --filter=@fieldnote/pdf build \
 && pnpm --filter=@fieldnote/worker build

# Drop dev dependencies from the tree that ships.
RUN pnpm --filter=@fieldnote/worker --prod deploy /deploy

# --- Runtime ---------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV CHROMIUM_PATH=/usr/bin/chromium

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      fonts-dejavu-core \
      ca-certificates \
      dumb-init \
 && rm -rf /var/lib/apt/lists/*

# Chromium runs untrusted-ish HTML; keep it off root.
RUN useradd --system --create-home --uid 10001 fieldnote
WORKDIR /app

COPY --from=build --chown=fieldnote:fieldnote /deploy ./
# Handlebars templates are read at runtime and are not part of the JS bundle.
COPY --from=build --chown=fieldnote:fieldnote /app/packages/pdf/templates ./node_modules/@fieldnote/pdf/templates

USER fieldnote
EXPOSE 8080

# dumb-init reaps the zombie processes Chromium leaves behind.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/index.js"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
