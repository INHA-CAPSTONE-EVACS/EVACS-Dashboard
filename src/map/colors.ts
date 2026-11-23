/**
 * 지도 레이어 색상. CSS 토큰(styles/theme.css)과 같은 값을 RGBA 배열로 둔다.
 * deck.gl은 CSS 변수를 못 읽으므로 두 곳에 같은 색이 존재한다 — 바꿀 때 같이 바꾼다.
 */
export type RGBA = [number, number, number, number];

export const MAP_COLORS = {
  /** 일반 차량 */
  normal: [96, 123, 143, 190] as RGBA,
  /** 정보가 오래된 차량 */
  stale: [78, 88, 96, 120] as RGBA,
  /** 긴급 차량 */
  emergency: [214, 78, 64, 255] as RGBA,
  emergencyRing: [214, 78, 64, 90] as RGBA,
  /** 양보 알림 수신 차량 강조 */
  alert: [214, 160, 56, 230] as RGBA,
  alertRing: [214, 160, 56, 70] as RGBA,
  /** 콘(영향 영역) H3 셀 */
  cone: [214, 78, 64, 34] as RGBA,
  coneLine: [214, 78, 64, 150] as RGBA,
  /** 경로 폴리라인 */
  route: [86, 156, 214, 220] as RGBA,
  routePoint: [86, 156, 214, 255] as RGBA,
  /** 긴급차량 궤적 */
  trail: [214, 78, 64, 160] as RGBA,
  /** 생성 모드에서 찍은 좌표 */
  picked: [222, 222, 222, 255] as RGBA,
  /** 긴급상황 위치 핀 */
  pin: [214, 78, 64, 235] as RGBA,
  pinSelected: [240, 118, 96, 255] as RGBA,
  pinEnded: [120, 130, 138, 190] as RGBA,
  /** 밀도 H3 셀 경계. 같은 색 셀이 붙어도 셀 하나하나가 보이게 한다. */
  densityLine: [18, 26, 32, 150] as RGBA,
} as const;

/** 밀도 히트맵: 낮음 → 높음. 관제 화면이라 채도를 낮게 간다. */
const DENSITY_RAMP: RGBA[] = [
  [40, 62, 78, 120],
  [46, 92, 104, 140],
  [78, 124, 108, 155],
  [142, 148, 92, 170],
  [192, 136, 66, 185],
  [206, 90, 62, 200],
];

export function densityColor(count: number, max: number): RGBA {
  if (max <= 0) return DENSITY_RAMP[0];
  const ratio = Math.min(1, Math.log1p(count) / Math.log1p(max));
  const idx = Math.min(DENSITY_RAMP.length - 1, Math.floor(ratio * DENSITY_RAMP.length));
  return DENSITY_RAMP[idx];
}

export const DENSITY_LEGEND = DENSITY_RAMP;
