import { describe, expect, it } from 'vitest';
import { VehicleLayer, shouldUseVehicleModels, vehicleOrientation } from './VehicleLayer';
import type { VehicleResponse } from '../api/contracts';
const car = (change: Partial<VehicleResponse> = {}): VehicleResponse => ({ vehicleId: 'car', vehicleType: 'NORMAL', longitude: 126.65, latitude: 37.445, speedMps: 10, headingDegrees: 0, laneIndex: 0, laneCount: 3, measuredAt: null, occurredAt: null, stale: false, ...change });

describe('차량 표현 및 보간 연결', () => {
  it('2D·광역·차선 숨김은 점, 확대된 3D 차선 상세는 모델을 사용한다', () => {
    expect(shouldUseVehicleModels(0, 19, true)).toBe(false);
    expect(shouldUseVehicleModels(45, 14, true)).toBe(false);
    expect(shouldUseVehicleModels(45, 19, false)).toBe(false);
    expect(shouldUseVehicleModels(45, 18.5, true)).toBe(true);
  });
  it('2D는 점이고 3D는 일반/긴급 차량 모델을 유형별로 인스턴싱한다', () => {
    const layer = new VehicleLayer();
    layer.applyDiff([], [car(), car({ vehicleId: 'ambulance', vehicleType: 'EMERGENCY' })], 0);
    const points = layer.toDeckLayers({ visible: true, showTrail: false, models: false });
    expect(points.find((l) => l.id === 'vehicle-layer')?.props.visible).toBe(true);
    const models = layer.toDeckLayers({ visible: true, showTrail: false, models: true });
    expect(models.find((l) => l.id === 'vehicle-layer')?.props.visible).toBe(false);
    const normal = models.find((l) => l.id === 'vehicle-model-normal');
    const emergency = models.find((l) => l.id === 'vehicle-model-emergency');
    expect(normal?.props).toMatchObject({ pickable: true, sizeScale: 1, _lighting: 'pbr' });
    // deck.gl의 비동기 scenegraph getter는 로딩 전 null이고 원본 URL은 별도 저장된다.
    expect(Reflect.get(normal!.props, Symbol.for('asyncPropOriginal')).scenegraph).toBe('/models/sedan.glb');
    expect(Reflect.get(emergency!.props, Symbol.for('asyncPropOriginal')).scenegraph).toBe('/models/emergency.glb');
    expect(normal?.props.data).toHaveLength(1);
    expect(emergency?.props.data).toHaveLength(1);
  });
  it('프레임 중간 모델 좌표와 알림 강조 조회 좌표가 일치한다', () => {
    const layer = new VehicleLayer();
    layer.applyDiff([], [car()], 0);
    layer.applyDiff([car()], [car({ latitude: 37.4451, headingDegrees: 90 })], 1000);
    expect(layer.updateFrame(1500)).toBe(true);
    expect(layer.lookup('car')?.latitude).toBeCloseTo(37.44505, 8);
    expect(layer.lookup('car')?.headingDegrees).toBeCloseTo(45);
    layer.updateFrame(2000);
    expect(layer.lookup('car')?.latitude).toBeCloseTo(37.4451, 8);
    expect(layer.updateFrame(5000)).toBe(false);
  });
  it('방위각을 glTF Y-up 모델의 올바른 ENU 방향으로 변환한다', () => {
    expect(vehicleOrientation(car({ headingDegrees: 0 }))).toEqual([0, 0, 90]);
    expect(vehicleOrientation(car({ headingDegrees: 90 }))).toEqual([0, -90, 90]);
    expect(vehicleOrientation(car({ headingDegrees: 180 }))).toEqual([0, -180, 90]);
  });
  it('이동 없이 속도·방위·차로만 바뀌어도 최신 텔레메트리를 반영한다', () => {
    const layer = new VehicleLayer();
    layer.applyDiff([], [car()], 0);
    layer.applyDiff([car()], [car({ speedMps: 0, headingDegrees: 90, laneIndex: 1 })], 1000);
    layer.updateFrame(2000);
    expect(layer.lookup('car')).toMatchObject({ speedMps: 0, headingDegrees: 90, laneIndex: 1 });
  });
});
