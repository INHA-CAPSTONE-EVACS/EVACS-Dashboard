import { Tile3DLayer } from '@deck.gl/geo-layers';

/** EVACS-Test/scenario-inhadae-wide: 인하대역 ~ 인하대 후문 광역 도로망 전체. */
export const WIDE_VIEW = {
  longitude: 126.6545,
  latitude: 37.449,
  zoom: 14.6,
  pitch: 45,
  bearing: -24,
};

/** 광역 도로망 안의 기준 교차로: 매소홀로 × 독배로 교통방송사거리. */
export const INHA_VIEW = {
  longitude: 126.65048,
  latitude: 37.4454,
  zoom: 18.5,
  pitch: 45,
  bearing: -24,
};

export function createRoadTilesLayer(
  visible: boolean,
  onLoaded: () => void,
  onError: (message: string) => void,
) {
  return new Tile3DLayer({
    id: 'inha-road-tiles',
    data: `${import.meta.env.BASE_URL}tiles/inhadae-wide/tileset.json`,
    visible,
    pickable: false,
    onTileLoad: onLoaded,
    onTileError: (_tile, message) => onError(message),
    onError: (error) => { onError(error.message); return true; },
  });
}
