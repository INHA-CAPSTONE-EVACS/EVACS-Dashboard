/**
 * 관제 화면 전체 레이아웃과 패널 배치 (설계서 DashboardPage).
 *
 * 조회 훅은 여기서만 부르고 결과를 각 패널·지도에 내려 준다.
 * 패널 간 선택 상태는 DashboardStore로만 오간다.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ControlApiClient } from '../api/ControlApiClient';
import type { EmergencyResponse, EmergencyStatus } from '../api/contracts';
import { useDashboardStore, type LayerKey } from '../store/DashboardStore';
import {
  useTrackedVehicle,
  useVehicleAlerts,
  useVehicleDensity,
  useVehicleSummary,
  useVehicles,
} from '../hooks/VehiclePollingHook';
import {
  useAlertedVehicles,
  useCone,
  useDispatchRoute,
  useDispatchRouteHistory,
  useEmergencies,
  useEmergency,
  useEvents,
  useRoute,
} from '../hooks/EmergencyQueryHook';
import { ControlMapView } from '../components/ControlMapView';
import { EmergencyListPanel } from '../components/EmergencyListPanel';
import { EmergencyDetailPanel } from '../components/EmergencyDetailPanel';
import { EmergencyCreateControl } from '../components/EmergencyCreateControl';
import { KpiPanel } from '../components/KpiPanel';
import { VehicleAlertPanel } from '../components/VehicleAlertPanel';
import { hhmmss, num } from '../utils/format';

/** 조회 주기(ms). 자주 바뀌는 것만 짧게 둔다. */
const INTERVAL = {
  vehicles: 1000,
  summary: 3000,
  density: 3000,
  emergencies: 2000,
  detail: 3000,
  route: 10000,
  // 워커가 운행 중 다시 계산하므로 접수 경로보다 자주 본다.
  dispatchRoute: 3000,
  events: 5000,
  cone: 2000,
  alerted: 2000,
  // 알림은 운전자에게 떠 있는 시간이 수십 초뿐이라 차량 위치만큼 자주 본다.
  vehicleAlerts: 1000,
} as const;

const LAYER_LABELS: Record<LayerKey, string> = {
  vehicles: '차량',
  cone: '콘 영역',
  heatmap: '밀도',
  alerts: '양보 알림',
  route: '경로',
  trail: '궤적',
  pins: '위치 핀',
};

export function DashboardPage() {
  const viewport = useDashboardStore((s) => s.viewport);
  const selectedId = useDashboardStore((s) => s.selectedEmergencyId);
  const selectEmergency = useDashboardStore((s) => s.selectEmergency);
  const layerVisibility = useDashboardStore((s) => s.layerVisibility);
  const toggleLayer = useDashboardStore((s) => s.toggleLayer);
  const vehicleTypeFilter = useDashboardStore((s) => s.vehicleTypeFilter);
  const setVehicleTypeFilter = useDashboardStore((s) => s.setVehicleTypeFilter);
  const focusAt = useDashboardStore((s) => s.focusAt);
  const trackedVehicleId = useDashboardStore((s) => s.trackedVehicleId);
  const trackVehicle = useDashboardStore((s) => s.trackVehicle);

  const [statusFilter, setStatusFilter] = useState<EmergencyStatus | ''>('ACTIVE');
  const [ending, setEnding] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // 경과 시간·시계가 멈춰 보이지 않게 1초마다 다시 그린다.
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const vehicles = useVehicles(viewport.bbox, vehicleTypeFilter, INTERVAL.vehicles);
  const summary = useVehicleSummary(INTERVAL.summary);
  // 추적 차량은 bbox 밖이어도 따라갈 수 있어야 해서 ID로 따로 조회한다.
  const tracked = useTrackedVehicle(trackedVehicleId, INTERVAL.vehicles);

  /** 추적 차량이 목록(bbox 조회)에 없으면 끼워 넣는다 — 지도 표시와 추적 카메라가 같은 좌표를 쓴다. */
  const mapVehicles = useMemo(() => {
    const list = vehicles.vehicles;
    const extra = tracked.data;
    if (!extra || list.some((v) => v.vehicleId === extra.vehicleId)) return list;
    return [...list, extra];
  }, [vehicles.vehicles, tracked.data]);

  // 밀도 해상도는 줌에 맞춘다. 멀리서 보면 큰 셀, 가까이면 작은 셀.
  const resolution = resolutionForZoom(viewport.zoom);
  const density = useVehicleDensity(
    viewport.bbox,
    vehicleTypeFilter,
    resolution,
    INTERVAL.density,
    layerVisibility.heatmap,
  );

  const emergencyQuery = useMemo(
    () => ({ status: statusFilter || undefined, limit: 200 }),
    [statusFilter],
  );
  const emergencies = useEmergencies(emergencyQuery, INTERVAL.emergencies);
  const detail = useEmergency(selectedId, INTERVAL.detail);
  const route = useRoute(selectedId, INTERVAL.route);
  const dispatchRoute = useDispatchRoute(selectedId, INTERVAL.dispatchRoute);
  const dispatchRouteHistory = useDispatchRouteHistory(selectedId, INTERVAL.dispatchRoute);
  const events = useEvents(selectedId, INTERVAL.events);
  const cone = useCone(selectedId, INTERVAL.cone, layerVisibility.cone);
  const alerted = useAlertedVehicles(selectedId, INTERVAL.alerted, layerVisibility.alerts);
  // 차량 기준 알림 현황. 긴급상황을 고르지 않아도, 레이어를 꺼도 계속 받는다
  // (지도 강조는 레이어 토글을 따르지만 패널·상태바는 항상 보여야 한다).
  const vehicleAlerts = useVehicleAlerts(INTERVAL.vehicleAlerts);

  const densityCells = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of density.data?.cells ?? []) out[c.h3Index] = c.vehicleCount;
    return out;
  }, [density.data]);

  /**
   * 지도에서 강조할 차량. 두 출처를 합친다 —
   * 알림 스트림이 알려 준 "지금 알림이 떠 있는 차량"(차량 기준, 상시)과
   * 고른 긴급상황의 "수신 확인 차량 집합"(긴급상황 기준). 같은 차량은 한 번만 센다.
   */
  const alertedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const alert of vehicleAlerts.data?.alerts ?? []) ids.add(alert.vehicleId);
    for (const id of alerted.data?.vehicleIds ?? []) ids.add(id);
    return [...ids];
  }, [vehicleAlerts.data, alerted.data]);

  /**
   * 콘은 "안 보이는" 이유가 셋이다 — 레이어를 껐거나, 긴급상황을 안 골랐거나,
   * Worker가 아직 계산을 안 했거나. 상태바에서 바로 구분되게 적는다.
   */
  const coneStatus = !layerVisibility.cone
    ? '숨김'
    : !selectedId
      ? '대상 없음'
      : cone.data?.available
        ? num(cone.data.cells.length)
        : '미산출';

  /**
   * 워커 경로도 "안 보이는" 이유가 여러 개다 — 긴급상황을 안 골랐거나, 워커가 아직
   * 안 쌓았거나(available=false), 쌓았는데 좌표 형식이 깨졌거나.
   */
  const dispatchStatus = !selectedId
    ? '대상 없음'
    : !dispatchRoute.data?.available
      ? '미산출'
      : !dispatchRoute.data.coordinatesParsed
        ? '좌표 해석 실패'
        : `v${dispatchRoute.data.routeVersion} · ${num(dispatchRouteHistory.data?.count ?? 0)}회`;

  /**
   * 생성 결과를 즉시 목록에 비추고 선택까지 옮긴다(이후는 목록 조회가 갱신).
   * 접수한 목적지에 핀이 찍히므로 그 위치로 카메라도 옮긴다.
   */
  const onCreated = useCallback(
    (created: EmergencyResponse) => {
      selectEmergency(created.id);
      emergencies.refresh();
      const lat = created.destinationLat ?? created.originLat;
      const lng = created.destinationLng ?? created.originLng;
      if (lat != null && lng != null) focusAt(lat, lng);
    },
    [selectEmergency, emergencies, focusAt],
  );

  /** 종료 요청 → 결과를 목록·상세에 반영. 지도 경로·콘 표시는 조회 결과를 따라 자연히 사라진다. */
  const onEnd = useCallback(
    async (id: string) => {
      setEnding(true);
      try {
        await ControlApiClient.endEmergency(id);
        emergencies.refresh();
        detail.refresh();
      } finally {
        setEnding(false);
      }
    },
    [emergencies, detail],
  );

  const offline = vehicles.error !== null && emergencies.error !== null;
  const activeEmergency = detail.data?.status === 'ACTIVE' ? detail.data : null;

  // 종료된(또는 목록에서 사라진) 긴급차량을 계속 따라다니지 않는다.
  useEffect(() => {
    if (!trackedVehicleId || !emergencies.data || statusFilter === 'ENDED') return;
    const stillActive = emergencies.data.emergencies.some(
      (e) => e.vehicleId === trackedVehicleId && e.status === 'ACTIVE',
    );
    if (!stillActive) trackVehicle(null);
  }, [trackedVehicleId, emergencies.data, statusFilter, trackVehicle]);

  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar__brand">
          <span className="topbar__mark" aria-hidden />
          <span className="topbar__name">EVACS</span>
          <span className="topbar__sub">긴급차량 우선통행 관제</span>
        </div>

        <div className="topbar__stats">
          <Stat label="표시 차량" value={num(vehicles.vehicles.length)} />
          <Stat label="긴급 차량" value={num(summary.data?.emergency)} accent />
          <Stat label="진행 상황" value={num(emergencies.data?.emergencies.filter((e) => e.status === 'ACTIVE').length)} accent />
        </div>

        <div className="topbar__right">
          <span className={`link-state${offline ? ' is-down' : ''}`}>
            <span className="dot" aria-hidden />
            {offline ? '서버 연결 끊김' : '정상'}
          </span>
          <span className="clock mono">{hhmmss(now)}</span>
        </div>
      </header>

      <div className="layout">
        <aside className="col col--left">
          <EmergencyListPanel
            list={emergencies.data}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            error={emergencies.error}
            busy={emergencies.inFlight}
            now={now}
          />
          <EmergencyCreateControl onCreated={onCreated} />
        </aside>

        <main className="col col--map">
          <div className="maptools">
            <div className="maptools__group">
              <span className="maptools__label">레이어</span>
              {(Object.keys(LAYER_LABELS) as LayerKey[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  className={`chip${layerVisibility[key] ? ' is-on' : ''}`}
                  onClick={() => toggleLayer(key)}
                >
                  {LAYER_LABELS[key]}
                </button>
              ))}
            </div>
            <div className="maptools__group">
              <span className="maptools__label">차량</span>
              <div className="segmented">
                {(
                  [
                    ['', '전체'],
                    ['NORMAL', '일반'],
                    ['EMERGENCY', '긴급'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={vehicleTypeFilter === value ? 'is-on' : ''}
                    onClick={() => setVehicleTypeFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <ControlMapView
            vehicles={mapVehicles}
            previousVehicles={vehicles.previous}
            cone={cone.data}
            alertedVehicleIds={alertedIds}
            route={route.data}
            dispatchRoute={dispatchRoute.data}
            densityCells={densityCells}
            trailVehicleId={activeEmergency?.vehicleId ?? null}
            emergencies={emergencies.data?.emergencies ?? []}
            selectedEmergencyId={selectedId}
          />

          <footer className="statusbar">
            <span className="mono">
              차량 {num(vehicles.vehicles.length)} · 갱신 {hhmmss(vehicles.updatedAt)}
            </span>
            <span className="mono">
              {layerVisibility.heatmap
                ? `밀도 R${resolution} · 셀 ${num(density.data?.cellCount ?? 0)}`
                : '밀도 숨김'}
            </span>
            <span className="mono">
              콘 {coneStatus} · 알림 {num(vehicleAlerts.data?.alerts.length ?? 0)}
              {vehicleAlerts.error ? ' (갱신 지연)' : ''}
            </span>
            {/* 경로가 "안 바뀐 것"과 "선택 안 함"을 구분해 준다 — 콘 표시와 같은 규칙. */}
            <span className="mono">경로 변경 {dispatchStatus}</span>
            <span className={`statusbar__state${vehicles.error ? ' is-warn' : ''}`}>
              {vehicles.error ? `갱신 지연 · ${vehicles.error}` : '실시간 갱신 중'}
            </span>
          </footer>
        </main>

        <aside className="col col--right">
          <EmergencyDetailPanel
            emergency={detail.data}
            route={route.data}
            dispatchRoute={dispatchRoute.data}
            dispatchRouteHistory={dispatchRouteHistory.data}
            events={events.data}
            cone={cone.data}
            alerted={alerted.data}
            error={detail.error}
            busy={detail.inFlight}
            now={now}
            onEnd={(id) => void onEnd(id)}
            ending={ending}
          />
          <VehicleAlertPanel
            alerts={vehicleAlerts.data}
            error={vehicleAlerts.error}
            busy={vehicleAlerts.inFlight}
            now={now}
          />
          <KpiPanel summary={summary.data} />
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`stat${accent ? ' stat--accent' : ''}`}>
      <span className="stat__label">{label}</span>
      <span className="stat__value mono">{value}</span>
    </div>
  );
}

/** 줌에 맞는 H3 해상도. 셀이 너무 작으면 응답이 커지고 너무 크면 의미가 없다. */
function resolutionForZoom(zoom: number): number {
  if (zoom >= 15) return 10;
  if (zoom >= 13) return 9;
  if (zoom >= 11) return 8;
  return 7;
}