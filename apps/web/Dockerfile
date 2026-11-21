FROM node:24.12.0-bookworm AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/package.json
COPY apps/admin-console/package.json apps/admin-console/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/client-sdk/package.json packages/client-sdk/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/localization/package.json packages/localization/package.json
COPY tools/content-validator/package.json tools/content-validator/package.json
RUN pnpm install --frozen-lockfile --filter @hanjjak/web...
COPY apps/web apps/web
# 빌드가 PNG 원본을 WebP 로 굽는다. 내용 해시 캐시를 BuildKit cache mount 로 이어 붙여
# 자산이 그대로인 커밋에서는 다시 굽지 않게 한다. 캐시가 비면 그만큼 빌드가 길어질 뿐
# 결과는 같다.
RUN --mount=type=cache,target=/webp-cache,sharing=locked \
    WEBP_CACHE_DIR=/webp-cache pnpm --filter @hanjjak/web build

FROM nginx:1.31.5-alpine
RUN apk add --no-cache openssl
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/docker-entrypoint.d/40-basic-auth.sh /docker-entrypoint.d/40-basic-auth.sh
RUN chmod +x /docker-entrypoint.d/40-basic-auth.sh && mkdir -p /etc/nginx/auth && : > /etc/nginx/auth/basic-auth.conf
COPY apps/web/public/deployment.html /usr/share/nginx/html/deployment.html
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=6 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
