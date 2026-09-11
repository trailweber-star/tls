# ------------------------------------------------------------------ #
# One container: the API, serving the built site from the same origin.
#
# For any host that takes a Dockerfile — Railway, Fly, Koyeb, Cloud Run,
# a VPS. Two stages so the shipped image carries no build tooling and no
# frontend dependency tree.
#
#   docker build -t tls .
#   docker run -p 4000:4000 -e DATABASE_URL=… -e AUTH_SECRET=… tls
# ------------------------------------------------------------------ #

# ----------------------------------------------- stage 1: the site
FROM node:20-alpine AS web

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
# Same origin as the API, so the browser calls /api on whatever host
# this ends up on — no rebuild per environment.
ENV VITE_API_URL=/api
RUN npm run build

# ------------------------------------------------- stage 2: the API
FROM node:20-alpine AS api

# dumb-init, so signals reach node and the container stops when asked.
RUN apk add --no-cache dumb-init
ENV NODE_ENV=production

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY backend/ ./
# The built site, where app.js looks for it by default.
COPY --from=web /app/frontend/dist /app/frontend/dist

# Uploaded photos and video land here. On a host with an ephemeral
# filesystem this is lost on redeploy — mount a volume, or point
# setStorageProvider() at S3/R2. Fine for a preview.
RUN mkdir -p uploads && chown -R node:node /app
USER node

EXPOSE 4000
ENV PORT=4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations first, then the server — see scripts/prepare.mjs.
ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "start:prod"]
