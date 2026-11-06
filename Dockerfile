# syntax=docker/dockerfile:1

FROM node:22-trixie-slim AS base
ENV PNPM_HOME="/pnpm" \
    COREPACK_HOME="/pnpm/corepack" \
    PATH="/pnpm:$PATH" \
    CI="true"
# Install the individually reviewed Docker hardened backports for CVEs that
# Debian 13 has not yet published. Do not upgrade unrelated packages. The slim
# base excludes docs; re-include only the changelogs used as patch evidence.
RUN printf '%s\n' \
      'path-include /usr/share/doc/sqlite3/changelog.Debian.gz' \
      'path-include /usr/share/doc/ncurses-bin/changelog.Debian.gz' \
      'path-include /usr/share/doc/zlib1g/changelog.Debian.gz' \
      > /etc/dpkg/dpkg.cfg.d/worldforge-vendor-evidence \
    && apt-get update -y \
    && apt-get install -y --no-install-recommends openssl ca-certificates curl gnupg \
    && curl -fsSL https://dhi.io/keyring/dhi-deb-gpg.D46852F6925E9F71.key \
      | gpg --dearmor -o /usr/share/keyrings/dhi-deb.gpg \
    && echo "deb [signed-by=/usr/share/keyrings/dhi-deb.gpg] https://dhi.io/deb/debian/main trixie main" \
      > /etc/apt/sources.list.d/dhi.list \
    && apt-get update -y \
    && apt-get install -y --no-install-recommends \
      sqlite3 libsqlite3-0 ncurses-bin libtinfo6 zlib1g \
    && chmod u-s /usr/bin/mount /usr/bin/umount \
    && apt-get purge -y --auto-remove curl gnupg \
    && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.34.9 --activate
WORKDIR /app

# Install dependencies without lifecycle scripts; Prisma and native builds are
# handled explicitly in the build stage once the source is present.
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --ignore-scripts

FROM deps AS build
RUN apt-get update -y \
    && apt-get install -y --no-install-recommends build-essential python3 unzip \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN export DATABASE_URL=file:/tmp/worldforge-build.db \
    && node scripts/build-patched-sqlite.mjs \
    && pnpm db:generate && pnpm stock-art:validate && pnpm build

FROM base AS runner
ENV NODE_ENV="production" \
    PORT="3033" \
    WORLDFORGE_ASSET_DIR="/data/assets"
# Operations use pnpm, Prisma and tsx. The separate npm/npx installation is
# unused at runtime and brings its own independently vulnerable dependency tree.
RUN rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/resources ./resources
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/prisma.config.ts ./prisma.config.ts
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
