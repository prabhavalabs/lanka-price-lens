ARG NODE_VERSION=24.19.0

FROM node:${NODE_VERSION}-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY shared/package.json shared/package.json
COPY archive/package.json archive/package.json
COPY foundry/package.json foundry/package.json
COPY api/package.json api/package.json
COPY admin/package.json admin/package.json
COPY web/package.json web/package.json
RUN pnpm install --frozen-lockfile
COPY shared shared
COPY archive archive
COPY foundry foundry
COPY api api
COPY admin admin
COPY web web
RUN pnpm build

FROM node:${NODE_VERSION}-bookworm-slim
ARG VCS_REF=unknown
WORKDIR /app
ENV NODE_ENV=production
LABEL org.opencontainers.image.source="https://github.com/prabhavalabs/lanka-price-lens" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.licenses="MIT"
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY shared/package.json shared/package.json
COPY archive/package.json archive/package.json
COPY foundry/package.json foundry/package.json
COPY api/package.json api/package.json
COPY admin/package.json admin/package.json
COPY web/package.json web/package.json
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && pnpm install --prod --frozen-lockfile \
  && apt-get purge -y python3 make g++ \
  && apt-get autoremove -y \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*
COPY shared/src shared/src
COPY archive/src archive/src
COPY foundry/src foundry/src
COPY api/src api/src
COPY data/manifests data/manifests
COPY data/mappings data/mappings
COPY data/recipes data/recipes
COPY --from=build /app/admin/dist admin/dist
COPY --from=build /app/web/dist web/dist
RUN mkdir /data && chown node:node /data
USER node
CMD ["node", "api/src/index.ts"]
