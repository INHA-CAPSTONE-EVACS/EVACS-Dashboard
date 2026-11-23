# 관제 대시보드 정적 번들 + /control 리버스 프록시.
#
#   docker build -t seoki/evacs-dashboard:latest .
#   docker run -d --network host -e CONTROL_UPSTREAM=http://127.0.0.1:8081 \
#     -e WEB_PORT=80 --name evacs_dashboard seoki/evacs-dashboard:latest
#
# 관제서버와 같은 오리진으로 서빙되므로 CORS 설정도, HTTPS 혼용(mixed content) 문제도 없다.
# VITE_API_BASE_URL은 비워 둔 채로 빌드한다 — 브라우저는 /control/*를 같은 호스트로 보내고
# nginx가 그것을 CONTROL_UPSTREAM으로 넘긴다.

FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
# --ignore-scripts: 의존성의 postinstall은 필요 없고, pnpm 10은 무시된 빌드 스크립트를
# ERR_PNPM_IGNORED_BUILDS로 승격시켜 install을 실패시킨다.
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm run build

FROM nginx:1.27-alpine
# nginx:alpine의 엔트리포인트가 templates/*.template를 envsubst로 렌더한다.
ENV CONTROL_UPSTREAM=http://127.0.0.1:8081 \
    WEB_PORT=80
COPY docker/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- "http://127.0.0.1:${WEB_PORT}/" >/dev/null || exit 1
