# Sarayan — production image.
#
# Multi-stage: dependencies, build, then a minimal runner using Next's
# standalone output. Runs as a non-root user with no build toolchain present.

FROM node:22-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/core-docs/package.json ./packages/core-docs/
COPY packages/core-evidence/package.json ./packages/core-evidence/
COPY packages/core-watch/package.json ./packages/core-watch/
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# DATABASE_URL is needed for the build to resolve types, not to connect.
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
RUN addgroup -g 1001 -S nodejs && adduser -S sarayan -u 1001

COPY --from=builder /app/apps/web/public ./apps/web/public
COPY --from=builder --chown=sarayan:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=sarayan:nodejs /app/apps/web/.next/static ./apps/web/.next/static
# Migrations and the taxonomy seed ship with the image so a release can apply
# them without a separate build.
COPY --from=builder --chown=sarayan:nodejs /app/apps/web/drizzle ./apps/web/drizzle

USER sarayan
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/web/server.js"]
