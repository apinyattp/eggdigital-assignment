FROM node:24.19.0-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM dependencies AS build
ARG NEXT_PUBLIC_API_BASE_URL
ARG API_PROXY_ORIGIN
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL API_PROXY_ORIGIN=$API_PROXY_ORIGIN
COPY . .
RUN test -n "$NEXT_PUBLIC_API_BASE_URL" || (echo "NEXT_PUBLIC_API_BASE_URL must be supplied at build time" >&2; exit 1)
RUN npm run build

FROM node:24.19.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/next.config.mjs ./next.config.mjs
USER node
EXPOSE 3000
CMD ["npm", "run", "start"]
