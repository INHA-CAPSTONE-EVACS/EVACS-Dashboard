/**
 * 셀별 차량 밀도를 H3 그리드 히트맵으로 표시 (설계서 HeatmapLayer).
 *
 * 입력은 설계서대로 Record<H3CellId, number>다.
 * 서버 DensityResponse.cells[]는 ControlMapView에서 이 형태로 줄여서 넘긴다.
 */
import { H3HexagonLayer } from '@deck.gl/geo-layers';
import type { Layer } from '@deck.gl/core';
import type { H3CellId } from '../api/contracts';
import { densityColor, MAP_COLORS } from './colors';

interface Cell {
  hex: H3CellId;
  count: number;
}

export class HeatmapLayer {
  private cells: Cell[] = [];
  private max = 0;
  private version = 0;

  /** 셀별 차량 수를 H3 그리드 색상으로 표시. */
  renderDensity(cellCounts: Record<H3CellId, number>): void {
    const entries = Object.entries(cellCounts);
    this.cells = entries.map(([hex, count]) => ({ hex, count }));
    this.max = entries.reduce((m, [, c]) => Math.max(m, c), 0);
    this.version += 1;
  }

  clear(): void {
    if (this.cells.length === 0) return;
    this.cells = [];
    this.max = 0;
    this.version += 1;
  }

  get maxCount(): number {
    return this.max;
  }

  get cellCount(): number {
    return this.cells.length;
  }

  toDeckLayers(options: { visible: boolean }): Layer[] {
    return [
      new H3HexagonLayer<Cell>({
        id: 'heatmap-layer',
        data: this.cells,
        visible: options.visible,
        pickable: true,
        filled: true,
        // 같은 색 셀이 붙어 있으면 경계가 사라진다. 셀 하나하나를 확인할 수 있어야 한다.
        stroked: true,
        extruded: false,
        highPrecision: false,
        getHexagon: (d) => d.hex,
        getFillColor: (d) => densityColor(d.count, this.max),
        getLineColor: MAP_COLORS.densityLine,
        lineWidthUnits: 'pixels',
        getLineWidth: 1,
        lineWidthMinPixels: 1,
        updateTriggers: {
          getHexagon: this.version,
          getFillColor: this.version,
        },
      }),
    ];
  }
}
