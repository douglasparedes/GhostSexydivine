FROM node:22-bookworm-slim

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src/ ./src/
COPY public/ ./public/

RUN mkdir -p /data && chown -R node:node /app /data

USER node

ENV PORT=3000
ENV DATA_DIR=/data

EXPOSE 3000

# NOTE: the probe must drain the body AND exit explicitly. An undici fetch
# with an unconsumed body holds the socket open, so `node -e` lingers past
# the timeout even against a healthy server. 127.0.0.1 avoids resolver
# involvement entirely.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then(async r => { try { await r.arrayBuffer(); } catch {} process.exit(r.ok ? 0 : 1); }).catch(() => process.exit(1))"

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
