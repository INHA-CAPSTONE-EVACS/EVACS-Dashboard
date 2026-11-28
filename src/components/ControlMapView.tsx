/**
 * 지도 렌더링, 표시 영역(bbox) 관리, 레이어 조립 (설계서 ControlMapView).
 *
 * 설계서 함수: onViewportChange(bbox, zoom), onMapClick(latitude, longitude), focusEmergency(id).
 * 데이터 조회는 DashboardPage가 훅으로 하고, 여기는 받은 데이터를 레이어에 꽂기만 한다.
 *
 * 구조 주의: MapLibre가 루트고 deck.gl은 그 위에 얹는 오버레이(MapboxOverlay)다.
 * 반대로 <DeckGL> 안에 <Map>을 넣는 예전 방식은 react-map-gl v8에서 지도에 viewState가
 * 전달되지 않아 베이스맵 타일이 아예 요청되지 않는다(실제로 그렇게 깨져서 바꿨다).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapboxOverlay, type MapboxOverlayProps } from '@deck.gl/mapbox';
import type { Layer, PickingInfo } from '@deck.gl/core';
import { PathLayer, ScatterplotLayer } from '@deck.gl/layers';
import {
  Map as MapLibre,
  useMap,
  type MapRef,
  type ViewStateChangeEvent,
  type MapLayerMouseEvent,
} from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

import type {
  Bbox,
  ConeResponse,
  DispatchRouteResponse,
  EmergencyResponse,
  EmergencyRouteResponse,
  VehicleResponse,
} from '../api/contracts';
import { useDashboardStore } from '../store/DashboardStore';
import { VehicleLayer, shouldUseVehicleModels } from '../map/VehicleLayer';
import { ConeLayer } from '../map/ConeLayer';
import { HeatmapLayer } from '../map/HeatmapLayer';
import { AlertHighlight } from '../map/AlertHighlight';
import { MAP_COLORS } from '../map/colors';
import { createEmergencyPinLayer, emergencyPins } from '../map/EmergencyPinLayer';
import { FOLLOW_VIEW, followStep, type FollowCamera } from '../map/VehicleFollowCamera';
import { createRoadTilesLayer, INHA_VIEW, WIDE_VIEW } from '../map/InhaRoadTiles';

/** 키 없이 쓰는 무료 다크 베이스맵. 사내 타일 서버가 생기면 여기만 바꾼다. */
const BASEMAP_STYLE =
  import.meta.env.VITE_BASEMAP_STYLE ??
  'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';

const INITIAL_VIEW = {
  ...WIDE_VIEW,
  longitude: Number(import.meta.env.VITE_INITIAL_LNG ?? WIDE_VIEW.longitude),
  latitude: Number(import.meta.env.VITE_INITIAL_LAT ?? WIDE_VIEW.latitude),
  zoom: Number(import.meta.env.VITE_INITIAL_ZOOM ?? WIDE_VIEW.zoom),
};

/** 지도를 끌 때마다 조회하면 서버가 버티지 못한다. 멈춘 뒤에만 조건을 갱신한다. */
const VIEWPORT_SETTLE_MS = 300;
/**
 * 추적 중에는 카메라가 계속 움직여 "멈춤"이 오지 않는다. 이 간격이 지나면 멈추지 않아도
 * bbox를 한 번 밀어 준다 — 안 하면 차량을 따라가는 동안 조회 영역이 낡아 차량이 사라진다.
 */
const VIEWPORT_FORCE_MS = 1200;
/** 추적 중 React 상태(줌·좌표 표시)를 갱신하는 최소 간격. 매 프레임 갱신하면 재렌더가 폭발한다. */
const TRACK_VIEWSTATE_MS = 250;
/** 추적 진입(차량뷰로 날아가는) 애니메이션 길이. 이 동안은 프레임 추적을 멈춘다. */
const FOLLOW_ENTRY_MS = 700;

interface Props {
  vehicles: VehicleResponse[];
  previousVehicles: VehicleResponse[];
  cone: ConeResponse | null;
  alertedVehicleIds: string[];
  route: EmergencyRouteResponse | null;
  /** 워커가 바꾼 최신 경로. 접수 경로와 같은 `경로` 토글로 함께 보여 준다. */
  dispatchRoute: DispatchRouteResponse | null;
  densityCells: Record<string, number>;
  /** 궤적을 그릴 긴급차량. 없으면 null. */
  trailVehicleId: string | null;
  /** 위치 핀을 찍을 긴급상황 목록. */
  emergencies: EmergencyResponse[];
  /** 선택된 긴급상황(핀 강조). */
  selectedEmergencyId: string | null;
}

/** deck.gl 레이어를 MapLibre 위에 얹는 컨트롤. */
type AnimationFrame = (now: number) => { layers: Layer[]; active: boolean };
function DeckOverlay(props: MapboxOverlayProps & { animationFrame?: AnimationFrame }) {
  const { current: map } = useMap();
  const overlayRef = useRef<MapboxOverlay | null>(null);
  // 지도에 부착한 인스턴스와 갱신 대상이 일치하도록 수명주기를 Effect에서 관리한다.
  // StrictMode 재마운트에서도 제거된 컨트롤로 setProps를 보내지 않는다.
  useEffect(() => {
    if (!map) return;
    const overlay = new MapboxOverlay({});
    overlayRef.current = overlay;
    map.addControl(overlay);
    return () => {
      overlayRef.current = null;
      if (map.hasControl(overlay)) map.removeControl(overlay);
    };
  }, [map]);
  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    const { animationFrame, layers = [], ...deckProps } = props;
    let frameId = 0;
    const draw = (now: number) => {
      const frame = animationFrame?.(now);
      overlay.setProps({ ...deckProps, layers: [...(layers as Layer[]), ...(frame?.layers ?? [])] });
      if (frame?.active) frameId = requestAnimationFrame(draw);
    };
    draw(performance.now());
    return () => cancelAnimationFrame(frameId);
  }, [map, props]);
  return null;
}

export function ControlMapView(props: Props) {
  const [viewState, setViewState] = useState(INITIAL_VIEW);
  const [roadsVisible, setRoadsVisible] = useState(true);
  const [tileStatus, setTileStatus] = useState('loading');
  const tileLoaded = useCallback(() => setTileStatus('ready'), []);
  const tileError = useCallback((message: string) => setTileStatus(`error: ${message}`), []);
  const [hovered, setHovered] = useState<PickingInfo | null>(null);
  const mapRef = useRef<MapRef>(null);

  const setViewport = useDashboardStore((s) => s.setViewport);
  const layerVisibility = useDashboardStore((s) => s.layerVisibility);
  const selectMode = useDashboardStore((s) => s.selectMode);
  const pickedPoints = useDashboardStore((s) => s.pickedPoints);
  const pickPoint = useDashboardStore((s) => s.pickPoint);
  const focusTarget = useDashboardStore((s) => s.focusTarget);
  const trackedVehicleId = useDashboardStore((s) => s.trackedVehicleId);
  const trackVehicle = useDashboardStore((s) => s.trackVehicle);

  // 추적 카메라는 rAF 안에서만 움직인다(React 상태로 두면 프레임마다 재렌더된다).
  const tracking = trackedVehicleId !== null;
  const trackingRef = useRef(false);
  trackingRef.current = tracking;
  const followRef = useRef<FollowCamera | null>(null);
  const acquiringUntil = useRef(0);
  const lastViewSync = useRef(0);
  const lastViewportPush = useRef(0);
  const [trackSignal, setTrackSignal] = useState(false);

  // 레이어 객체는 렌더 간 유지되어야 변경분 계산(applyDiff)이 의미가 있다.
  const vehicleLayer = useRef(new VehicleLayer()).current;
  const coneLayer = useRef(new ConeLayer()).current;
  const heatmapLayer = useRef(new HeatmapLayer()).current;
  const alertHighlight = useRef(new AlertHighlight(vehicleLayer.lookup)).current;

  /** 표시 영역 변경을 Store에 반영하여 차량 조회 조건 갱신. */
  const onViewportChange = useCallback(
    (bbox: Bbox, zoom: number) => setViewport(bbox, zoom),
    [setViewport],
  );

  /** 긴급상황 생성 모드일 때 선택 좌표를 EmergencyCreateControl에 전달. */
  const onMapClick = useCallback(
    (latitude: number, longitude: number) => pickPoint(latitude, longitude),
    [pickPoint],
  );

  /** 선택한 긴급상황 위치로 지도 이동. */
  const focusEmergency = useCallback((latitude: number, longitude: number) => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({
      center: [longitude, latitude],
      zoom: Math.max(map.getZoom(), 14),
      duration: 600,
    });
  }, []);

  useEffect(() => {
    if (!focusTarget) return;
    focusEmergency(focusTarget.latitude, focusTarget.longitude);
  }, [focusTarget, focusEmergency]);

  // 추적 시작/해제. 첫 좌표를 받은 프레임에서 차량뷰로 날아가고, 이후 중심·방위는 rAF가 따라간다.
  useEffect(() => {
    followRef.current = null;
    if (!trackedVehicleId) setTrackSignal(false);
  }, [trackedVehicleId]);

  // 지도가 멈춘 뒤 실제 지도 경계를 읽어 Store로 보낸다.
  // 추적 중에는 멈추지 않으므로 VIEWPORT_FORCE_MS마다 강제로 한 번 보낸다.
  useEffect(() => {
    let timer = 0;
    const push = () => {
      const bounds = mapRef.current?.getBounds();
      if (!bounds) {
        // 지도 인스턴스가 아직 없다. 첫 조회 조건이 영영 안 나가면 차량·밀도가 0으로 멈춘다.
        timer = window.setTimeout(push, 200);
        return;
      }
      lastViewportPush.current = performance.now();
      onViewportChange(
        {
          minLat: bounds.getSouth(),
          maxLat: bounds.getNorth(),
          minLng: bounds.getWest(),
          maxLng: bounds.getEast(),
        },
        viewState.zoom,
      );
    };
    const overdue = performance.now() - lastViewportPush.current > VIEWPORT_FORCE_MS;
    timer = window.setTimeout(push, overdue ? 0 : VIEWPORT_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [viewState, onViewportChange]);

  // --- 데이터를 레이어 상태에 반영 ---

  if (props.cone?.available) {
    coneLayer.renderCone(props.cone.cells.map((c) => c.h3Index));
  } else {
    coneLayer.clear();
  }

  if (layerVisibility.heatmap) {
    heatmapLayer.renderDensity(props.densityCells);
  } else {
    heatmapLayer.clear();
  }

  const models = shouldUseVehicleModels(viewState.pitch, viewState.zoom, roadsVisible);
  const animateVehicles = useCallback<AnimationFrame>((now) => {
    vehicleLayer.applyDiff(props.previousVehicles, props.vehicles, now);
    vehicleLayer.renderTrail(layerVisibility.trail ? props.trailVehicleId : null);
    const active = vehicleLayer.updateFrame(now);
    alertHighlight.highlight(props.alertedVehicleIds);
    // 차량뷰 추적: 보간된 표시 좌표를 그대로 카메라에 넣는다(React 재렌더 없음).
    if (trackedVehicleId) {
      const vehicle = vehicleLayer.getVehicle(trackedVehicleId);
      const map = mapRef.current;
      if (vehicle && map) {
        if (!followRef.current) {
          // 첫 좌표를 받은 순간. 화면 밖에 있을 수 있으니 순간이동 대신 날아간다.
          followRef.current = {
            longitude: vehicle.longitude,
            latitude: vehicle.latitude,
            bearing: vehicle.headingDegrees,
          };
          acquiringUntil.current = now + FOLLOW_ENTRY_MS;
          map.easeTo({
            center: [vehicle.longitude, vehicle.latitude],
            zoom: Math.max(map.getZoom(), FOLLOW_VIEW.zoom),
            pitch: Math.max(map.getPitch?.() ?? 0, FOLLOW_VIEW.pitch),
            bearing: vehicle.headingDegrees,
            duration: FOLLOW_ENTRY_MS,
          });
        } else if (now >= acquiringUntil.current) {
          followRef.current = followStep(followRef.current, vehicle);
          map.jumpTo({
            center: [followRef.current.longitude, followRef.current.latitude],
            bearing: followRef.current.bearing,
          });
        } else {
          // 진입 애니메이션 중. 여기서 jumpTo를 부르면 easeTo가 취소돼 줌·기울기가 안 바뀐다.
          followRef.current = { ...followRef.current, longitude: vehicle.longitude, latitude: vehicle.latitude };
        }
      }
      setTrackSignal(vehicle !== undefined);
    }
    return {
      layers: [
        ...vehicleLayer.toDeckLayers({ visible: layerVisibility.vehicles, showTrail: layerVisibility.trail, models }),
        ...alertHighlight.toDeckLayers({ visible: layerVisibility.alerts && layerVisibility.vehicles, tick: now }),
      ],
      // 추적 중에는 차량이 멈춰 있어도 프레임을 계속 받아야 다시 움직일 때 바로 따라간다.
      active: (active && (layerVisibility.vehicles || layerVisibility.trail)) || trackedVehicleId !== null,
    };
  }, [vehicleLayer, alertHighlight, props.previousVehicles, props.vehicles, props.trailVehicleId, props.alertedVehicleIds, layerVisibility, models, trackedVehicleId]);

  const layers = useMemo<Layer[]>(() => {
    const routePoints = props.route?.points ?? [];
    const result: Layer[] = [
      createRoadTilesLayer(roadsVisible, tileLoaded, tileError),
      ...heatmapLayer.toDeckLayers({ visible: layerVisibility.heatmap }),
      ...coneLayer.toDeckLayers({ visible: layerVisibility.cone }),
      createEmergencyPinLayer(
        emergencyPins(props.emergencies),
        props.selectedEmergencyId,
        layerVisibility.pins,
      ),
    ];

    if (layerVisibility.route && routePoints.length > 1) {
      result.push(
        new PathLayer<{ path: [number, number][] }>({
          id: 'route-layer',
          data: [{ path: routePoints.map((p) => [p.longitude, p.latitude]) }],
          getPath: (d) => d.path,
          getColor: MAP_COLORS.route,
          getWidth: 3,
          widthUnits: 'pixels',
          widthMinPixels: 2,
          capRounded: true,
          jointRounded: true,
        }),
      );
      result.push(
        new ScatterplotLayer<(typeof routePoints)[number]>({
          id: 'route-endpoints-layer',
          data: [routePoints[0], routePoints[routePoints.length - 1]],
          getPosition: (p) => [p.longitude, p.latitude],
          getRadius: 5,
          radiusUnits: 'pixels',
          getFillColor: MAP_COLORS.routePoint,
        }),
      );
    }

    // 워커가 경로를 다시 계산했으면 접수 경로 위에 겹쳐 그린다 — 어디가 바뀌었는지 눈으로 비교하는 용도.
    const dispatchCoordinates = props.dispatchRoute?.available
      ? props.dispatchRoute.coordinates
      : [];
    if (layerVisibility.route && dispatchCoordinates.length > 1) {
      result.push(
        new PathLayer<{ path: [number, number][] }>({
          id: 'dispatch-route-layer',
          data: [{ path: dispatchCoordinates.map((p) => [p.longitude, p.latitude]) }],
          getPath: (d) => d.path,
          getColor: MAP_COLORS.dispatchRoute,
          getWidth: 4,
          widthUnits: 'pixels',
          widthMinPixels: 2,
          capRounded: true,
          jointRounded: true,
        }),
      );
    }

    // 접수 폼에서 찍은 출발지·목적지. 출발지는 초록, 목적지는 흰 원으로 구분한다.
    for (const [target, point] of Object.entries(pickedPoints)) {
      if (!point) continue;
      result.push(
        new ScatterplotLayer<{ latitude: number; longitude: number }>({
          id: `picked-${target}-layer`,
          data: [point],
          getPosition: (p) => [p.longitude, p.latitude],
          getRadius: 6,
          radiusUnits: 'pixels',
          filled: false,
          stroked: true,
          lineWidthUnits: 'pixels',
          getLineWidth: 1.5,
          getLineColor: target === 'origin' ? MAP_COLORS.pickedOrigin : MAP_COLORS.picked,
        }),
      );
    }

    return result;
    // 레이어 객체는 내부 version으로 갱신을 판단하므로, 데이터가 바뀐 시점에만 재조립한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.vehicles,
    props.cone,
    props.route,
    props.dispatchRoute,
    props.alertedVehicleIds,
    props.densityCells,
    props.trailVehicleId,
    layerVisibility,
    roadsVisible,
    tileLoaded,
    tileError,
    pickedPoints,
    props.emergencies,
    props.selectedEmergencyId,
  ]);

  return (
    <div className={`map-wrapper${selectMode ? ' map-wrapper--picking' : ''}`}>
      <MapLibre
        ref={mapRef}
        initialViewState={INITIAL_VIEW}
        mapStyle={BASEMAP_STYLE}
        attributionControl={{ compact: true }}
        dragRotate={true}
        maxPitch={65}
        cursor={selectMode ? 'crosshair' : 'grab'}
        onMove={(e: ViewStateChangeEvent) => {
          // 추적 중에는 카메라가 매 프레임 움직인다 — 표시용 상태는 간헐적으로만 맞춘다.
          const now = performance.now();
          if (trackingRef.current && now - lastViewSync.current < TRACK_VIEWSTATE_MS) return;
          lastViewSync.current = now;
          setViewState({
            longitude: e.viewState.longitude,
            latitude: e.viewState.latitude,
            zoom: e.viewState.zoom,
            pitch: e.viewState.pitch,
            bearing: e.viewState.bearing,
          });
        }}
        onClick={(e: MapLayerMouseEvent) => {
          if (selectMode) onMapClick(e.lngLat.lat, e.lngLat.lng);
        }}
        onLoad={() => {
          // 베이스맵 문제는 조용히 실패한다. 개발 중에는 콘솔에서 지도 객체를 바로 본다.
          if (import.meta.env.DEV) {
            (window as unknown as { __map?: unknown }).__map = mapRef.current?.getMap();
          }
        }}
        onError={(e: unknown) => {
          const err = e as { error?: Error; message?: string };
          console.error('[basemap]', err?.error?.message ?? err?.message ?? e);
        }}
      >
        <DeckOverlay
          layers={layers}
          animationFrame={animateVehicles}
          onHover={(info: PickingInfo) => setHovered(info.object ? info : null)}
        />
      </MapLibre>

      <div className="road-controls">
        <div className="road-controls__heading">인하대권 광역 · 인하대역~후문</div>
        <div className="road-controls__buttons">
          <button className="btn" onClick={() => mapRef.current?.easeTo({ center: [WIDE_VIEW.longitude, WIDE_VIEW.latitude], zoom: WIDE_VIEW.zoom, pitch: WIDE_VIEW.pitch, bearing: WIDE_VIEW.bearing, duration: 600 })}>광역 보기</button>
          <button className="btn" onClick={() => mapRef.current?.easeTo({ center: [INHA_VIEW.longitude, INHA_VIEW.latitude], zoom: INHA_VIEW.zoom, pitch: INHA_VIEW.pitch, bearing: INHA_VIEW.bearing, duration: 600 })}>기준 교차로</button>
          <button className="btn" onClick={() => mapRef.current?.easeTo({ pitch: viewState.pitch > 0 ? 0 : 45, duration: 400 })}>{viewState.pitch > 0 ? '2D 보기' : '3D 보기'}</button>
          <button className={`btn${roadsVisible ? ' is-on' : ''}`} aria-pressed={roadsVisible} onClick={() => setRoadsVisible((v) => !v)}>차선 상세</button>
        </div>
        <div className="road-controls__note" role="status">
          {!roadsVisible ? '차선 상세 숨김' : tileStatus === 'ready' ? 'SUMO 도로망 · 3D Tiles' : tileStatus.startsWith('error') ? '도로 타일 로드 실패 — 새로고침해 재시도하십시오' : '도로 타일 불러오는 중…'}
        </div>
        <div className="road-controls__note">차선 경계는 시뮬레이션 형상 기반 · 실측 노면표시 아님</div>
        <div className="road-controls__note">{models ? '차량 3D 모델 · 수신 좌표 보간' : '차량 점 표시 · 3D 차선 상세 확대 시 모델 표시'}</div>
      </div>

      {tracking && (
        <div className="map-banner map-banner--track">
          <span className="mono">{trackedVehicleId}</span>
          {trackSignal ? ' 차량뷰 추적 중' : ' 위치 신호 없음 — 조회 영역 밖이거나 종료된 차량'}
          <button type="button" className="btn" onClick={() => trackVehicle(null)}>
            추적 해제
          </button>
        </div>
      )}

      {selectMode && (
        <div className="map-banner">
          좌표 선택 모드 — 지도를 클릭해 긴급차량{' '}
          {selectMode === 'origin' ? '출발지' : '목적지'}를 지정하십시오
        </div>
      )}

      {hovered?.object ? <MapTooltip info={hovered} /> : null}

      <div className="map-scale">
        <span className="mono">ZOOM {viewState.zoom.toFixed(1)}</span>
        <span className="mono">
          {viewState.latitude.toFixed(4)} / {viewState.longitude.toFixed(4)}
        </span>
      </div>
    </div>
  );
}

function MapTooltip({ info }: { info: PickingInfo }) {
  const o = info.object as Partial<VehicleResponse> & { hex?: string; count?: number };
  const style = { left: info.x + 12, top: info.y + 12 };

  if (o.hex) {
    return (
      <div className="map-tooltip" style={style}>
        <div className="map-tooltip__title mono">{o.hex}</div>
        <div className="map-tooltip__row">
          <span>차량 수</span>
          <span className="mono">{o.count}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="map-tooltip" style={style}>
      <div className="map-tooltip__title mono">{o.vehicleId}</div>
      <div className="map-tooltip__row">
        <span>유형</span>
        <span className="mono">{o.vehicleType}</span>
      </div>
      <div className="map-tooltip__row">
        <span>속도</span>
        <span className="mono">{((o.speedMps ?? 0) * 3.6).toFixed(1)} km/h</span>
      </div>
      <div className="map-tooltip__row">
        <span>방위</span>
        <span className="mono">{(o.headingDegrees ?? 0).toFixed(0)}°</span>
      </div>
      {o.laneIndex != null && (
        <div className="map-tooltip__row">
          <span>차로</span>
          <span className="mono">
            {o.laneIndex + 1} / {o.laneCount ?? '-'}
          </span>
        </div>
      )}
    </div>
  );
}
