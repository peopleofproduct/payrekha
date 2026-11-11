# SPDX-License-Identifier: Apache-2.0
# PayRekha intent connector — pick the transport at runtime:
#   docker run -e CONNECTOR=kafka … payrekha-connector
FROM node:26-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
# Locked transitive tree, no install scripts — same posture as deploy/Dockerfile.
RUN npm ci --omit=dev --ignore-scripts
COPY lib/ lib/
COPY fieldmaps/ fieldmaps/
COPY webhook.mjs kafka.mjs sqs.mjs ./
USER node
ENV CONNECTOR=webhook \
    PAYREKHA_URL=http://payrekha:8080
ENTRYPOINT ["sh", "-c", "exec node ${CONNECTOR}.mjs"]
