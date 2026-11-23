/**
 * 긴급상황 위치 핀 (지도 마커).
 *
 * 핀 위치는 **목적지**다 — SUMO 모드는 출발 차고지가 시나리오에 고정돼 있고 발생지가 없으므로,
 * 관제에서 봐야 하는 좌표는 긴급차량이 향하는 지점이다. 목적지가 없는 옛 데이터는 발생지로 떨어진다.
 *
 * 아이콘은 외부 파일 없이 SVG data URL 하나를 mask로 쓴다(색은 상태별 틴트로 준다).
 */
import { IconLayer } from '@deck.gl/layers';
import type { EmergencyResponse } from '../api/contracts';
import { MAP_COLORS, type RGBA } from './colors';

export interface EmergencyPin {
  id: string;
  vehicleId: string;
  latitude: number;
  longitude: number;
  active: boolean;
  /** 좌표가 목적지인지(아니면 발생지 폴백인지) */
  fromDestination: boolean;
}

const PIN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="64" viewBox="0 0 48 64">' +
  '<path d="M24 1C12.4 1 3 10.4 3 22c0 14.9 21 41 21 41s21-26.1 21-41C45 10.4 35.6 1 24 1z"/>' +
  '</svg>';

/** anchorY=64: 핀 끝(바닥)이 실제 좌표에 닿는다. mask=true라야 getColor 틴트가 먹는다. */
export const PIN_ICON = {
  url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(PIN_SVG)}`,
  width: 48,
  height: 64,
  anchorY: 64,
  mask: true,
};

/** 좌표가 있는 긴급상황만 핀으로 만든다. */
export function emergencyPins(emergencies: EmergencyResponse[]): EmergencyPin[] {
  const pins: EmergencyPin[] = [];
  for (const e of emergencies) {
    const fromDestination = e.destinationLat != null && e.destinationLng != null;
    const latitude = fromDestination ? e.destinationLat : e.originLat;
    const longitude = fromDestination ? e.destinationLng : e.originLng;
    if (latitude == null || longitude == null) continue;
    pins.push({
      id: e.id,
      vehicleId: e.vehicleId,
      latitude,
      longitude,
      active: e.status === 'ACTIVE',
      fromDestination,
    });
  }
  return pins;
}

function pinColor(pin: EmergencyPin, selectedId: string | null): RGBA {
  if (!pin.active) return MAP_COLORS.pinEnded;
  return pin.id === selectedId ? MAP_COLORS.pinSelected : MAP_COLORS.pin;
}

export function createEmergencyPinLayer(
  pins: EmergencyPin[],
  selectedId: string | null,
  visible: boolean,
): IconLayer<EmergencyPin> {
  return new IconLayer<EmergencyPin>({
    id: 'emergency-pin-layer',
    data: pins,
    visible,
    pickable: false,
    getIcon: () => PIN_ICON,
    getPosition: (p) => [p.longitude, p.latitude],
    getSize: (p) => (p.id === selectedId ? 44 : 32),
    sizeUnits: 'pixels',
    getColor: (p) => pinColor(p, selectedId),
    updateTriggers: { getColor: selectedId, getSize: selectedId },
  });
}
