import { describe, it, expect } from 'vitest';
import { createRoadTilesLayer, INHA_VIEW, WIDE_VIEW } from './InhaRoadTiles';

describe('인하대 도로 3D Tiles', () => {
  it('광역 도로망 전체가 들어오는 배율로 시작한다', () => {
    expect(WIDE_VIEW.longitude).toBeCloseTo(126.6545, 4);
    expect(WIDE_VIEW.latitude).toBeCloseTo(37.449, 4);
    expect(WIDE_VIEW.zoom).toBeLessThan(16);
    expect(WIDE_VIEW.pitch).toBeGreaterThan(0);
  });
  it('기준 교차로는 교통방송사거리에서 차선이 보이는 확대 배율이다', () => {
    expect(INHA_VIEW.longitude).toBeCloseTo(126.65048, 5);
    expect(INHA_VIEW.latitude).toBeCloseTo(37.4454, 5);
    expect(INHA_VIEW.zoom).toBeGreaterThanOrEqual(18);
    expect(INHA_VIEW.pitch).toBeGreaterThan(0);
  });
  it('로컬 tileset을 로드하고 실제 타일 로딩과 실패를 전달한다', () => {
    const loaded: string[] = [];
    const errors: string[] = [];
    const layer = createRoadTilesLayer(true, () => loaded.push('loaded'), (s) => errors.push(s));
    expect(layer.id).toBe('inha-road-tiles');
    expect(layer.props.data).toBe('/tiles/inhadae-wide/tileset.json');
    expect(layer.props.visible).toBe(true);
    layer.props.onTileLoad?.({} as never);
    layer.props.onTileError?.({} as never, 'missing tile', '/bad.b3dm');
    expect(loaded).toEqual(['loaded']);
    expect(errors[0]).toContain('missing tile');
    expect(createRoadTilesLayer(false, () => {}, () => {}).props.visible).toBe(false);
  });
});
