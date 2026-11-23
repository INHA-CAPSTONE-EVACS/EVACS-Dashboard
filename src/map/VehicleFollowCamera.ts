/**
 * 차량 추적 카메라(차량뷰).
 *
 * 지도를 보간된 차량 표시 좌표에 붙여 따라가게 만든다. 호출은 deck.gl 오버레이의 rAF 안에서
 * 일어나므로(React 재렌더 없음) 매 프레임 호출돼도 안전해야 한다 — 그래서 여기엔 지도 객체가
 * 들어오지 않고 다음 카메라 값만 계산한다.
 */
import type { VehicleResponse } from '../api/contracts';

/** 추적 시작 시 한 번 맞추는 시점. 줌 17 이상이어야 차량 3D 모델이 나온다. */
export const FOLLOW_VIEW = { zoom: 18, pitch: 55 } as const;

/** 방위 보간 계수(프레임당). 1이면 즉시 돌아 멀미가 나고, 작으면 코너에서 늦게 돈다. */
const BEARING_SMOOTHING = 0.12;
/** 이보다 느리면 방위를 바꾸지 않는다. 정지 차량의 heading은 들쭉날쭉하다. */
const MIN_TURN_SPEED_MPS = 0.6;

export interface FollowCamera {
  longitude: number;
  latitude: number;
  bearing: number;
}

const normalize = (angle: number) => ((angle % 360) + 360) % 360;
/** -180~180의 최단 회전량. 350° → 10°는 0°를 지나 +20°다. */
const shortestTurn = (from: number, to: number) => ((to - from + 540) % 360) - 180;

/**
 * 다음 프레임의 카메라.
 *
 * 중심은 차량 좌표를 그대로 쓴다(이미 VehicleMotion이 보간한 값이다).
 * 방위만 최단 회전 방향으로 조금씩 따라간다.
 */
export function followStep(
  camera: FollowCamera,
  vehicle: Pick<VehicleResponse, 'latitude' | 'longitude' | 'headingDegrees' | 'speedMps'>,
  smoothing = BEARING_SMOOTHING,
): FollowCamera {
  const moving = (vehicle.speedMps ?? 0) >= MIN_TURN_SPEED_MPS;
  const heading = Number.isFinite(vehicle.headingDegrees) ? normalize(vehicle.headingDegrees) : camera.bearing;
  const bearing = moving
    ? normalize(camera.bearing + shortestTurn(camera.bearing, heading) * Math.min(1, Math.max(0, smoothing)))
    : camera.bearing;
  return { longitude: vehicle.longitude, latitude: vehicle.latitude, bearing };
}
