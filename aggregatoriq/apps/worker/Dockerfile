# Worker image.
#
# The workspace packages are TypeScript source rather than built artefacts, so
# the whole monorepo is copied and run through tsx. That is a deliberate trade:
# a slightly larger image in exchange for never shipping a stale `dist` that
# silently shadows a change to the engine — which is the class of bug that ends
# with a customer seeing an old number.

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY packages/core/package.json packages/core/
COPY packages/engine/package.json packages/engine/
COPY packages/parsers/package.json packages/parsers/
COPY packages/db/package.json packages/db/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter @aggregatoriq/worker...

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages ./packages
COPY --from=deps /app/apps/worker ./apps/worker
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/worker ./apps/worker

# Runs unprivileged. The worker accepts files from the internet on the inbound
# email endpoint, so root would be a poor default.
USER node

EXPOSE 8080

# The worker validates its whole environment at boot and exits on anything
# missing, so a bad deploy fails here rather than on the first inbound statement.
CMD ["pnpm", "--filter", "@aggregatoriq/worker", "start"]
