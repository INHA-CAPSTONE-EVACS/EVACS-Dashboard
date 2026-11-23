import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

/**
 * /control/* 요청은 관제서버로 프록시한다. 같은 오리진으로 보이게 해서 CORS를 없앤다.
 * 대상 서버는 VITE_PROXY_TARGET으로 바꾼다 (mock-server는 8099, 실제 관제서버는 8081).
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = env.VITE_PROXY_TARGET || 'http://localhost:8081';

  return {
    // GitHub Pages는 /<repo>/ 하위에 서빙되므로 배포 시 VITE_BASE=/EVACS-Dashboard/ 를 준다.
    // 코드에서 모델·타일 경로는 import.meta.env.BASE_URL로 조립하므로 이 값만 맞추면 된다.
    base: env.VITE_BASE || '/',
    plugins: [react()],
    // maplibre-gl은 타일 파싱을 Web Worker에서 한다. Vite 기본값(iife)으로 묶이면
    // dev에서 "Worker failed to load"로 죽고 베이스맵이 통째로 빈 화면이 된다.
    worker: { format: 'es' as const },
    server: {
      port: Number(env.VITE_PORT || 5273),
      proxy: {
        '/control': { target, changeOrigin: true },
      },
    },
  };
});
