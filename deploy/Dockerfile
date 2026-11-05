# syntax=docker/dockerfile:1
# Payrekha reference gateway. Non-root, read-only root filesystem friendly
# (state and logs go to /var/lib/payrekha), HEALTHCHECK on /healthz.
#
#   docker build -f deploy/Dockerfile -t payrekha .
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/rules/package.json packages/rules/package.json
COPY packages/gateway/package.json packages/gateway/package.json
COPY packages/replay/package.json packages/replay/package.json
RUN npm ci --ignore-scripts
COPY packages packages
RUN npx tsc -b packages/gateway && npm prune --omit=dev --ignore-scripts

FROM node:22-slim AS runtime
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=build --chown=root:root /app/node_modules node_modules
COPY --from=build --chown=root:root /app/package.json package.json
COPY --from=build --chown=root:root /app/packages packages
COPY --chown=root:root examples/reference-gateway.mjs examples/reference-gateway.mjs
COPY --chown=root:root config config
RUN mkdir -p /var/lib/payrekha && chown node:node /var/lib/payrekha
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "examples/reference-gateway.mjs"]
