import { describe, expect, it } from 'vitest';
import { followStep, FOLLOW_VIEW } from './VehicleFollowCamera';

const vehicle = (over: Partial<{ latitude: number; longitude: number; headingDegrees: number; speedMps: number }> = {}) => ({
  latitude: 37.4454,
  longitude: 126.6505,
  headingDegrees: 90,
  speedMps: 10,
  ...over,
});

describe('차량 추적 카메라', () => {
  it('차량뷰는 차량 3D 모델이 나오는 줌(17 이상)과 기울기를 쓴다', () => {
    expect(FOLLOW_VIEW.zoom).toBeGreaterThanOrEqual(17);
    expect(FOLLOW_VIEW.pitch).toBeGreaterThan(1);
  });

  it('중심은 차량 좌표를 그대로 따르고 방위는 조금씩 수렴한다', () => {
    const start = { longitude: 126.65, latitude: 37.44, bearing: 0 };
    const next = followStep(start, vehicle());
    expect(next.longitude).toBe(126.6505);
    expect(next.latitude).toBe(37.4454);
    expect(next.bearing).toBeGreaterThan(0);
    expect(next.bearing).toBeLessThan(90);

    let camera = start;
    for (let i = 0; i < 200; i += 1) camera = followStep(camera, vehicle());
    expect(camera.bearing).toBeCloseTo(90, 3);
  });

  it('방위는 최단 회전 방향으로 돈다(350° → 10°는 0°를 지난다)', () => {
    const next = followStep({ longitude: 0, latitude: 0, bearing: 350 }, vehicle({ headingDegrees: 10 }), 0.5);
    expect(next.bearing).toBeCloseTo(0, 6);
  });

  it('정지 차량의 흔들리는 heading으로 화면을 돌리지 않는다', () => {
    const next = followStep({ longitude: 0, latitude: 0, bearing: 180 }, vehicle({ speedMps: 0.1, headingDegrees: 10 }));
    expect(next.bearing).toBe(180);
    expect(next.latitude).toBe(37.4454);
  });
});
