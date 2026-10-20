# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm" \
    PATH="/pnpm:$PATH" \
    CI="true"
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# Install dependencies without lifecycle scripts; Prisma and native builds are
# handled explicitly in the build stage once the source is present.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
COPY . .
RUN pnpm db:generate && pnpm build

FROM base AS runner
ENV NODE_ENV="production" \
    PORT="3033" \
    WORLDFORGE_ASSET_DIR="/data/assets"
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/next.config.ts ./next.config.ts
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/src ./src
COPY --from=build /app/scripts ./scripts
RUN chmod +x ./scripts/docker-entrypoint.sh
EXPOSE 3033
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
CMD ["pnpm", "start"]
