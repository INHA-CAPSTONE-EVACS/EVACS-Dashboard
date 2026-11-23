/**
 * 양보 알림을 받은 차량의 마커를 강조 (설계서 AlertHighlight).
 *
 * 차량 좌표는 VehicleLayer가 들고 있다. 두 객체가 서로를 참조하면 생성 순서가 꼬이므로
 * 객체가 아니라 조회 함수(lookup)를 주입받는다.
 */
import { ScatterplotLayer } from '@deck.gl/layers';
import type { Layer } from '@deck.gl/core';
import type { VehicleResponse } from '../api/contracts';
import { MAP_COLORS } from './colors';

type VehicleLookup = (vehicleId: string) => VehicleResponse | undefined;

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
    ];
  }
}
