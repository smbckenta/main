# ビルド用ステージ。devDependencies はここだけで使う。
FROM node:22-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# 実行用ステージ。本番依存のみを持つ。
FROM node:22-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

# Cloud Run は PORT を注入する。ローカル実行のための既定値。
ENV PORT=8080
EXPOSE 8080

USER node
CMD ["node", "dist/index.js"]
