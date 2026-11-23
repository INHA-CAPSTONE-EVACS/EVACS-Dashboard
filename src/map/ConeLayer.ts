/**
 * 긴급차량의 콘 영역(H3 셀 집합)을 지도에 육각형으로 표시 (설계서 ConeLayer).
 *
 * 이전 셀 집합과 달라진 셀(추가·제거)만 갱신한다 — 같은 집합이 다시 와도 version을 올리지 않아
 * deck.gl이 레이어를 다시 만들지 않는다.
 */
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import type { Layer } from '@deck.gl/core';
import type { H3CellId } from '../api/contracts';
import { MAP_COLORS } from './colors';

export class ConeLayer {
  private cells = new Set<H3CellId>();
  private version = 0;
  private lastChange = { added: 0, removed: 0 };

  /** 콘의 H3 셀 집합을 육각형으로 표시. 이전 셀 집합과 달라진 셀(추가·제거)만 갱신. */
  renderCone(cells: H3CellId[]): void {
    const next = new Set(cells);
    let added = 0;
    for (const c of next) if (!this.cells.has(c)) added += 1;
    let removed = 0;
    for (const c of this.cells) if (!next.has(c)) removed += 1;

    if (added === 0 && removed === 0) return;
    this.cells = next;
    this.lastChange = { added, removed };
    this.version += 1;
  }

  clear(): void {
    if (this.cells.size === 0) return;
    this.cells = new Set();
    this.version += 1;
  }

  get cellCount(): number {
    return this.cells.size;
  }

  getLastChange(): { added: number; removed: number } {
    return this.lastChange;
  }

  toDeckLayers(options: { visible: boolean }): Layer[] {
    const data = [...this.cells].map((hex) => ({ hex }));
    return [
      new H3HexagonLayer<{ hex: string }>({
        id: 'cone-layer',
        data,
        visible: options.visible,
        pickable: false,
        filled: true,
        stroked: true,
        extruded: false,
        highPrecision: false,
        getHexagon: (d) => d.hex,
        getFillColor: MAP_COLORS.cone,
        getLineColor: MAP_COLORS.coneLine,
        lineWidthUnits: 'pixels',
        getLineWidth: 1,
        updateTriggers: { getHexagon: this.version },
      }),
    ];
  }
}
