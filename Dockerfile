FROM node:24.19.0-bookworm-slim AS build
WORKDIR /app
RUN corepack enable
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY shared/package.json shared/package.json
COPY foundry/package.json foundry/package.json
COPY api/package.json api/package.json
COPY admin/package.json admin/package.json
RUN pnpm install --frozen-lockfile
COPY shared shared
COPY foundry foundry
COPY api api
COPY admin admin
RUN pnpm build

FROM node:24.19.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY shared/package.json shared/package.json
COPY foundry/package.json foundry/package.json
COPY api/package.json api/package.json
COPY admin/package.json admin/package.json
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && pnpm install --prod --frozen-lockfile \
  && apt-get purge -y python3 make g++ \
  && apt-get autoremove -y \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*
COPY shared/src shared/src
COPY foundry/src foundry/src
COPY api/src api/src
COPY data/manifests data/manifests
COPY --from=build /app/admin/dist admin/dist
RUN mkdir /data && chown node:node /data
USER node
CMD ["node", "api/src/index.ts"]
