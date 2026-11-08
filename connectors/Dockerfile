# SPDX-License-Identifier: Apache-2.0
# PayRekha intent connector — pick the transport at runtime:
#   docker run -e CONNECTOR=kafka … payrekha-connector
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-package-lock kafkajs@2.2.4 2>/dev/null || true
COPY lib/ lib/
COPY fieldmaps/ fieldmaps/
COPY webhook.mjs kafka.mjs sqs.mjs ./
USER node
ENV CONNECTOR=webhook \
    PAYREKHA_URL=http://payrekha:8080
ENTRYPOINT ["sh", "-c", "exec node ${CONNECTOR}.mjs"]
