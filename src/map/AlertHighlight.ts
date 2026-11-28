/**
 * 양보 알림을 받은 차량의 마커를 강조 (설계서 AlertHighlight).
 *
 * 차량 좌표는 VehicleLayer가 들고 있다. 두 객체가 서로를 참조하면 생성 순서가 꼬이므로
 * 객체가 아니라 조회 함수(lookup)를 주입받는다.
 */
import { IconLayer, ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { VehicleResponse } from '../api/contracts';
import { MAP_COLORS, type RGBA } from './colors';

type VehicleLookup = (vehicleId: string) => VehicleResponse | undefined;

/** 느낌표 배지 높이(m). 차량 3D 모델(1.5m 내외)보다 위에 떠야 모델에 가려지지 않는다. */
const BADGE_ALTITUDE_M = 4;
const BADGE_BASE_SIZE = 30;
/** 배지 크기 맥박(±%). 멀리서도 눈에 걸리게 하되 어지럽지 않은 폭. */
const BADGE_PULSE = 0.12;
const BADGE_PULSE_MS = 900;

function rgb([r, g, b]: RGBA): string {
  return `rgb(${r},${g},${b})`;
}

/**
 * 느낌표 배지 아이콘. mask=false로 두고 SVG 안에서 색을 직접 칠한다 —
 * mask로 쓰면 알파만 남아 느낌표 글리프가 배경과 같은 색으로 묻힌다.
 */
const BADGE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="52" viewBox="0 0 40 52">' +
  // 차량을 가리키는 꼬리
  `<path d="M20 52 L13 38 L27 38 Z" fill="${rgb(MAP_COLORS.alert)}"/>` +
  `<circle cx="20" cy="20" r="18" fill="${rgb(MAP_COLORS.alert)}" stroke="#1a1208" stroke-width="2.5"/>` +
  '<rect x="17.2" y="8.5" width="5.6" height="16" rx="2.8" fill="#1a1208"/>' +
  '<circle cx="20" cy="30.5" r="3.2" fill="#1a1208"/>' +
  '</svg>';

/** anchorY=52: 배지 꼬리 끝이 차량 좌표(배지 고도) 위에 닿는다. */
export const ALERT_BADGE_ICON = {
  url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(BADGE_SVG)}`,
  width: 40,
  height: 52,
  anchorY: 52,
  mask: false,
};

/** 가까이서도 알림 차량이 구분되게 배지 크기를 주기적으로 키운다. */
export function badgeSize(now: number): number {
  const phase = Math.sin((now / BADGE_PULSE_MS) * Math.PI * 2);
  return BADGE_BASE_SIZE * (1 + BADGE_PULSE * phase);
}

export class AlertHighlight {
  private ids = new Set<string>();
  private version = 0;
  private readonly lookup: VehicleLookup;

  constructor(lookup: VehicleLookup) {
    this.lookup = lookup;
  }

  /** 양보 알림 수신 차량 마커를 강조 표시하고, 목록에서 빠진 차량은 강조 해제. */
  highlight(vehicleIds: string[]): void {
    const next = new Set(vehicleIds);
    if (next.size === this.ids.size && [...next].every((id) => this.ids.has(id))) {
      return; // 같은 집합이면 아무것도 하지 않는다
    }
    this.ids = next;
    this.version += 1;
  }

  clear(): void {
    if (this.ids.size === 0) return;
    this.ids = new Set();
    this.version += 1;
  }

  get count(): number {
    return this.ids.size;
  }

  /**
   * 좌표를 아는 차량만 그린다. 강조 대상이지만 지금 표시 영역 밖에 있는 차량은
   * VehicleLayer에 없으므로 자연히 빠진다.
   */
  toDeckLayers(options: { visible: boolean; tick: number }): Layer[] {
    const data: VehicleResponse[] = [];
    for (const id of this.ids) {
      const v = this.lookup(id);
      if (v) data.push(v);
    }
    return [
      // 바닥 링: 멀리서(점 표시) 어느 쪽에 알림이 몰렸는지 보는 용도.
      new ScatterplotLayer<VehicleResponse>({
        id: 'alert-highlight-layer',
        data,
        visible: options.visible,
        pickable: false,
        radiusUnits: 'pixels',
        getPosition: (d) => [d.longitude, d.latitude],
        getRadius: 9,
        radiusMinPixels: 6,
        filled: true,
        getFillColor: MAP_COLORS.alertRing,
        stroked: true,
        lineWidthUnits: 'pixels',
        getLineWidth: 1.5,
        getLineColor: MAP_COLORS.alert,
        updateTriggers: {
          getPosition: options.tick,
          getFillColor: this.version,
        },
      }),
      // 느낌표 배지: 차량 위에 떠서 3D 모델 확대 상태에서도 가려지지 않는다.
      new IconLayer<VehicleResponse>({
        id: 'alert-badge-layer',
        data,
        visible: options.visible,
        pickable: false,
        billboard: true,
        getIcon: () => ALERT_BADGE_ICON,
        getPosition: (d) => [d.longitude, d.latitude, BADGE_ALTITUDE_M],
        getSize: badgeSize(options.tick),
        sizeUnits: 'pixels',
        updateTriggers: {
          getPosition: options.tick,
          getSize: options.tick,
        },
      }),
    ];
  }
}
