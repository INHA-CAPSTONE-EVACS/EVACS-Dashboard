import { describe, expect, it } from 'vitest';
import type { EmergencyResponse } from '../api/contracts';
import { createEmergencyPinLayer, emergencyPins, PIN_ICON, type EmergencyPin } from './EmergencyPinLayer';
import { MAP_COLORS } from './colors';

function emergency(over: Partial<EmergencyResponse>): EmergencyResponse {
  return {
    id: 'e1',
    vehicleId: 'EVACS_EMG_CALL_001',
    status: 'ACTIVE',
    emergencyType: 'FIRE',
    originLat: null,
    originLng: null,
    destinationLat: 37.4477,
    destinationLng: 126.6532,
    description: null,
    startedAt: null,
    endedAt: null,
    isSumo: true,
    ...over,
  };
}

describe('긴급상황 위치 핀', () => {
  it('SUMO 긴급상황은 목적지에 핀을 찍고, 목적지가 없으면 발생지로 떨어진다', () => {
    const pins = emergencyPins([
      emergency({}),
      emergency({ id: 'e2', destinationLat: null, destinationLng: null, originLat: 37.4454, originLng: 126.6505, isSumo: false }),
      emergency({ id: 'e3', destinationLat: null, destinationLng: null }),
    ]);
    expect(pins.map((p) => p.id)).toEqual(['e1', 'e2']);
    expect(pins[0]).toMatchObject({ latitude: 37.4477, longitude: 126.6532, fromDestination: true, active: true });
    expect(pins[1]).toMatchObject({ latitude: 37.4454, longitude: 126.6505, fromDestination: false });
  });

  it('핀 끝이 좌표에 닿고 선택·종료 상태가 색과 크기로 구분된다', () => {
    const pins = emergencyPins([emergency({}), emergency({ id: 'e2', status: 'ENDED' })]);
    const layer = createEmergencyPinLayer(pins, 'e1', true);
    // deck.gl 접근자 타입은 유니온이라 테스트에서는 함수로 좁혀 쓴다.
    const call = <T,>(fn: unknown) => (fn as (p: EmergencyPin) => T);
    expect(layer.id).toBe('emergency-pin-layer');
    expect(layer.props.visible).toBe(true);
    expect(layer.props.data).toHaveLength(2);
    expect(PIN_ICON.anchorY).toBe(PIN_ICON.height);
    expect(PIN_ICON.mask).toBe(true);
    expect(PIN_ICON.url.startsWith('data:image/svg+xml')).toBe(true);
    expect(call<typeof PIN_ICON>(layer.props.getIcon)(pins[0])).toBe(PIN_ICON);
    expect(call<number[]>(layer.props.getPosition)(pins[0])).toEqual([126.6532, 37.4477]);
    expect(call<number[]>(layer.props.getColor)(pins[0])).toEqual(MAP_COLORS.pinSelected);
    expect(call<number[]>(layer.props.getColor)(pins[1])).toEqual(MAP_COLORS.pinEnded);
    expect(call<number>(layer.props.getSize)(pins[0])).toBeGreaterThan(call<number>(layer.props.getSize)(pins[1]));
    expect(createEmergencyPinLayer(pins, null, false).props.visible).toBe(false);
  });
});
