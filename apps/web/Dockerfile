# syntax=docker/dockerfile:1
# Build from the repo root:  docker build -f apps/web/Dockerfile .
FROM node:26-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/print-agent/package.json apps/print-agent/
COPY packages/shared/package.json packages/shared/
RUN npm ci -w apps/web --include-workspace-root=false

FROM deps AS build
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1
# API_ORIGIN is read at build time by next.config.js rewrites; the compose file passes it.
ARG API_ORIGIN=http://api:3001
ENV API_ORIGIN=$API_ORIGIN
RUN cd apps/web && npx next build

FROM node:26-bookworm-slim AS run
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
RUN useradd --system --uid 1001 cafe
COPY --from=build --chown=cafe /app/apps/web/.next/standalone ./
COPY --from=build --chown=cafe /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=cafe /app/apps/web/public ./apps/web/public
USER cafe
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
