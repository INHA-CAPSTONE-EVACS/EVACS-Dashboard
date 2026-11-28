/**
 * 관제서버 REST API 호출 (설계서 ControlApiClient).
 *
 * 서버 VehicleController / EmergencyController의 함수에 1:1로 대응한다.
 * 대시보드는 Shared Client를 쓰지 않고 이 클라이언트만 쓴다.
 *
 * 호출 지연을 KpiPanel이 쓸 수 있게 여기서 같이 기록한다.
 * 서버에 KPI 엔드포인트가 없으므로 p99/처리량은 "클라이언트가 관측한 값"이다(README의 확정 필요 항목).
 */
import type {
  AlertedVehiclesResponse,
  ConeResponse,
  CreateEmergencyDto,
  DensityQueryDto,
  DensityResponse,
  DispatchRouteHistoryResponse,
  DispatchRouteResponse,
  EmergencyListResponse,
  EmergencyQueryDto,
  EmergencyResponse,
  EmergencyRouteResponse,
  EventLogResponse,
  VehicleListResponse,
  VehicleQueryDto,
  VehicleResponse,
  VehicleSummaryResponse,
} from './contracts';
import { apiMetrics } from './apiMetrics';

/** 서버가 내려준 오류를 화면이 사유로 표시할 수 있게 상태코드를 들고 간다. */
export class ControlApiError extends Error {
  readonly status: number;
  readonly detail?: string;

  constructor(status: number, message: string, detail?: string) {
    super(message);
    this.name = 'ControlApiError';
    this.status = status;
    this.detail = detail;
  }
}

const BASE = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');

function toQuery(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    sp.set(key, String(value));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function request<T>(
  path: string,
  init?: RequestInit & { label?: string },
): Promise<T> {
  const started = performance.now();
  const label = init?.label ?? path;
  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (e) {
    apiMetrics.record(label, performance.now() - started, false);
    throw new ControlApiError(0, '관제서버에 연결하지 못했습니다', String(e));
  }

  const elapsed = performance.now() - started;
  apiMetrics.record(label, elapsed, response.ok);

  if (!response.ok) {
    // GlobalExceptionHandler가 내려주는 본문을 그대로 사유로 쓴다(409 중복 생성 등).
    const text = await response.text().catch(() => '');
    throw new ControlApiError(
      response.status,
      serverMessage(text) ?? `요청 실패 (HTTP ${response.status})`,
      text,
    );
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function serverMessage(body: string): string | null {
  if (!body) return null;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const msg = parsed.message ?? parsed.detail ?? parsed.error;
    return typeof msg === 'string' && msg.trim() ? msg : null;
  } catch {
    return body.slice(0, 200);
  }
}

export const ControlApiClient = {
  /** 서버: getVehicles(VehicleQueryDto) */
  fetchVehicles(query: VehicleQueryDto, signal?: AbortSignal) {
    return request<VehicleListResponse>(`/control/vehicles${toQuery({ ...query })}`, {
      signal,
      label: 'vehicles',
    });
  },

  /** 서버: getVehicle(vehicleId) */
  fetchVehicle(vehicleId: string, signal?: AbortSignal) {
    return request<VehicleResponse>(
      `/control/vehicles/${encodeURIComponent(vehicleId)}`,
      { signal, label: 'vehicle' },
    );
  },

  /** 서버: getSummary() */
  fetchVehicleSummary(signal?: AbortSignal) {
    return request<VehicleSummaryResponse>('/control/vehicles/summary', {
      signal,
      label: 'summary',
    });
  },

  /** 서버: getDensity(DensityQueryDto) — HeatmapLayer가 쓴다. */
  fetchDensity(query: DensityQueryDto, signal?: AbortSignal) {
    return request<DensityResponse>(`/control/vehicles/density${toQuery({ ...query })}`, {
      signal,
      label: 'density',
    });
  },

  /** 서버: getEmergencies(EmergencyQueryDto) */
  fetchEmergencies(query: EmergencyQueryDto, signal?: AbortSignal) {
    return request<EmergencyListResponse>(
      `/control/emergencies${toQuery({ ...query })}`,
      { signal, label: 'emergencies' },
    );
  },

  /** 서버: getEmergency(id) */
  fetchEmergency(id: string, signal?: AbortSignal) {
    return request<EmergencyResponse>(`/control/emergencies/${id}`, {
      signal,
      label: 'emergency',
    });
  },

  /** 서버: getRoute(id) */
  fetchRoute(id: string, signal?: AbortSignal) {
    return request<EmergencyRouteResponse>(`/control/emergencies/${id}/route`, {
      signal,
      label: 'route',
    });
  },

  /** 서버: getDispatchRoute(id) — 워커가 바꾼 최신 경로. 지도·상세 패널이 쓴다. */
  fetchDispatchRoute(id: string, signal?: AbortSignal) {
    return request<DispatchRouteResponse>(
      `/control/emergencies/${id}/dispatch-route`,
      { signal, label: 'dispatchRoute' },
    );
  },

  /** 서버: getDispatchRouteHistory(id) — 경로 변경 횟수 확인용 요약. */
  fetchDispatchRouteHistory(id: string, signal?: AbortSignal) {
    return request<DispatchRouteHistoryResponse>(
      `/control/emergencies/${id}/dispatch-route/history`,
      { signal, label: 'dispatchRouteHistory' },
    );
  },

  /** 서버: getEvents(id) */
  fetchEvents(id: string, signal?: AbortSignal) {
    return request<EventLogResponse[]>(`/control/emergencies/${id}/events`, {
      signal,
      label: 'events',
    });
  },

  /** 서버: getCone(id) — ConeLayer가 쓴다. */
  fetchCone(id: string, signal?: AbortSignal) {
    return request<ConeResponse>(`/control/emergencies/${id}/cone`, {
      signal,
      label: 'cone',
    });
  },

  /** 서버: getAlertedVehicles(id) — AlertHighlight가 쓴다. */
  fetchAlertedVehicles(id: string, signal?: AbortSignal) {
    return request<AlertedVehiclesResponse>(
      `/control/emergencies/${id}/alerted-vehicles`,
      { signal, label: 'alerted' },
    );
  },

  /** 서버: createEmergency(CreateEmergencyDto) */
  createEmergency(dto: CreateEmergencyDto) {
    return request<EmergencyResponse>('/control/emergencies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dto),
      label: 'createEmergency',
    });
  },

  /**
   * 서버: endEmergency(id)
   * DELETE가 아니라 POST /end다 — 자원을 지우는 게 아니라 상태를 전이시킨다.
   */
  endEmergency(id: string) {
    return request<EmergencyResponse>(`/control/emergencies/${id}/end`, {
      method: 'POST',
      label: 'endEmergency',
    });
  },
};
