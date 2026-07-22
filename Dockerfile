# werknario CLI as a container. Build once, run against GitLab, GitHub, or the
# offline mock. Config comes from environment variables (see .env.example).
#
#   docker build -t werknario .
#   docker run --rm -e LLM_PROVIDER=mock -e WERKNARIO_BACKEND=mock \
#     werknario "Draft the split sheet from the session note" --yes

# ---- build ----
FROM node:20 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY tsconfig.base.json ./
COPY packages ./packages
COPY registry ./registry
# Skip the ~300 MB Playwright/Chromium download pulled transitively by the
# extension's browser-test dependency. The CLI and proxy never need a browser,
# and skipping it keeps the build working offline / air-gapped.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci
RUN npm run build

# ---- runtime ----
FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app ./
# Drop dev dependencies (test/build tooling) from the image.
RUN npm prune --omit=dev && npm cache clean --force
# The agent writes its audit log under the working directory by default.
# Mount a volume at /work to keep it, or point WERKNARIO_AUDIT elsewhere.
WORKDIR /work
ENTRYPOINT ["node", "/app/packages/cli/dist/cli.js"]
