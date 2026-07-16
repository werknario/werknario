# Registry service image. Build context is the REPO ROOT (the builder needs the
# extension workspaces to produce the ext-store):
#   docker build -f registry/Dockerfile -t werknario-vsx:latest .

# --- builder: compile workspaces, package the extension, lay out the store ---
FROM node:24-alpine AS build
WORKDIR /build
RUN apk add --no-cache bash unzip
# manifests first so the npm ci layer caches across source-only changes
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/gitlab-client/package.json ./packages/gitlab-client/
COPY packages/proxy/package.json ./packages/proxy/
COPY packages/extension/package.json ./packages/extension/
COPY registry/package.json ./registry/
# dev deps only feed the compile; never let them pull browser binaries
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci --no-fund --no-audit
COPY . .
RUN npm run build && npm run -w @werknario/registry build
RUN bash registry/scripts/build-ext-store.sh /build/ext-store

# --- runtime: registry dist + lockfile-exact prod deps + the store ---
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app
# npm ci against the SAME lockfile the CI verify stage exercised — no version
# drift between test and prod (review finding). Workspaces need every member's
# package.json present, so copy just those manifests.
COPY --from=build /build/package.json /build/package-lock.json ./
COPY --from=build /build/packages/shared/package.json ./packages/shared/
COPY --from=build /build/packages/gitlab-client/package.json ./packages/gitlab-client/
COPY --from=build /build/packages/proxy/package.json ./packages/proxy/
COPY --from=build /build/packages/extension/package.json ./packages/extension/
COPY --from=build /build/registry/package.json ./registry/
RUN npm ci --omit=dev --no-fund --no-audit && npm cache clean --force
COPY --from=build /build/registry/dist ./registry/dist
COPY --from=build /build/ext-store ./ext-store
ENV PORT=8080 \
    EXT_STORE=/app/ext-store \
    UPSTREAM_URL=https://open-vsx.org
# PUBLIC_BASE_URL is deploy-specific and intentionally has no default —
# the server refuses to start without it (see registry/src/config.ts).
EXPOSE 8080
USER node
CMD ["node", "registry/dist/server.js"]
