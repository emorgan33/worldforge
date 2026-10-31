# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm" \
    COREPACK_HOME="/pnpm/corepack" \
    PATH="/pnpm:$PATH" \
    CI="true"
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates sqlite3 \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.14.0 --activate
WORKDIR /app

# Install dependencies without lifecycle scripts; Prisma and native builds are
# handled explicitly in the build stage once the source is present.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY . .
RUN pnpm db:generate && pnpm stock-art:validate && pnpm build

FROM base AS runner
ENV NODE_ENV="production" \
    PORT="3033" \
    WORLDFORGE_ASSET_DIR="/data/assets"
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/resources ./resources
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
RUN groupadd --gid 10001 worldforge \
    && useradd --uid 10001 --gid worldforge --home-dir /app --no-create-home worldforge \
    && mkdir -p /data/assets \
    && chown -R worldforge:worldforge /data /app/.next /pnpm \
    && chmod +x ./scripts/docker-entrypoint.sh
USER worldforge
EXPOSE 3033
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
CMD ["pnpm", "start"]
