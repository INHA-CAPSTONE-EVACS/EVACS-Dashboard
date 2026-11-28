import { describe, expect, it } from 'vitest';
import { ALERT_BADGE_ICON, AlertHighlight, badgeSize } from './AlertHighlight';
import type { VehicleResponse } from '../api/contracts';

function vehicle(id: string): VehicleResponse {
  return {
    vehicleId: id,
    latitude: 37.4454,
    longitude: 126.65048,
    speedMps: 5,
    headingDegrees: 90,
    vehicleType: 'NORMAL',
    laneIndex: 0,
    laneCount: 2,
    measuredAt: '2026-01-01T00:00:00Z',
    occurredAt: '2026-01-01T00:00:00Z',
    stale: false,
  };
}

describe('AlertHighlight', () => {
  const lookup = (id: string) => (id === 'v1' ? vehicle('v1') : undefined);

  it('알림 차량 위에 느낌표 배지를 띄운다(3D 모델에 가려지지 않는 고도)', () => {
    const highlight = new AlertHighlight(lookup);
    highlight.highlight(['v1']);
    const layers = highlight.toDeckLayers({ visible: true, tick: 0 });
    const badge = layers.find((l) => l.id === 'alert-badge-layer');
    expect(badge).toBeDefined();
    const props = badge!.props as unknown as {
      data: VehicleResponse[];
      billboard: boolean;
      getPosition: (v: VehicleResponse) => number[];
    };
    expect(props.data.map((v) => v.vehicleId)).toEqual(['v1']);
    expect(props.billboard).toBe(true);
    expect(props.getPosition(vehicle('v1'))[2]).toBeGreaterThan(2);
    // 배지는 색을 틴트로 받지 않고 SVG 안에서 칠한다(느낌표가 묻히지 않게).
    expect(ALERT_BADGE_ICON.mask).toBe(false);
  });

  it('좌표를 모르는 차량은 배지도 바닥 링도 그리지 않는다', () => {
    const highlight = new AlertHighlight(lookup);
    highlight.highlight(['v1', 'unknown']);
    for (const layer of highlight.toDeckLayers({ visible: true, tick: 0 })) {
      expect((layer.props as unknown as { data: unknown[] }).data).toHaveLength(1);
    }
  });

  it('배지 크기는 맥박처럼 커졌다 작아진다', () => {
    const sizes = [0, 225, 450, 675].map(badgeSize);
    expect(Math.max(...sizes)).toBeGreaterThan(Math.min(...sizes));
    for (const size of sizes) {
      expect(size).toBeGreaterThan(20);
      expect(size).toBeLessThan(40);
    }
  });
});
