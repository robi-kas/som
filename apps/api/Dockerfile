# syntax=docker/dockerfile:1
# Build from the repo root:  docker build -f apps/api/Dockerfile .
FROM node:26-bookworm-slim AS deps
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/print-agent/package.json apps/print-agent/
COPY packages/shared/package.json packages/shared/
RUN npm ci -w apps/api --include-workspace-root=false

FROM deps AS build
COPY apps/api apps/api
RUN cd apps/api && npx prisma generate && npx nest build

FROM node:26-bookworm-slim AS run
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl tini && rm -rf /var/lib/apt/lists/* \
  && useradd --system --uid 1001 --home /app cafe
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
WORKDIR /app/apps/api
RUN mkdir -p uploads && chown -R cafe /app/apps/api/uploads
USER cafe
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://127.0.0.1:3001/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# Apply pending migrations, then start. Migrations are additive, so this is safe on every deploy.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
