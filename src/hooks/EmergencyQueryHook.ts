/**
 * 긴급상황 목록·상세·경로·이력 조회 (설계서 EmergencyQueryHook).
 *
 * 목록은 주기 조회, 상세·경로·이력은 선택된 건에 대해서만 조회한다.
 * 선택이 없으면(enabled=false) 요청 자체를 보내지 않는다.
 */
import { ControlApiClient } from '../api/ControlApiClient';
import type {
  AlertedVehiclesResponse,
  ConeResponse,
  EmergencyListResponse,
  EmergencyQueryDto,
  EmergencyResponse,
  EmergencyRouteResponse,
  EventLogResponse,
} from '../api/contracts';
import { usePolling, type PollingResult } from './usePolling';

/** 긴급상황 목록 주기 조회. */
export function useEmergencies(
  query: EmergencyQueryDto,
  intervalMs: number,
): PollingResult<EmergencyListResponse> {
  return usePolling<EmergencyListResponse>(
    (signal) => ControlApiClient.fetchEmergencies(query, signal),
    intervalMs,
    [query.status, query.vehicleId, query.limit],
  );
}

/** 선택한 긴급상황 상세 조회. */
export function useEmergency(
  id: string | null,
  intervalMs: number,
): PollingResult<EmergencyResponse> {
  return usePolling<EmergencyResponse>(
    (signal) => ControlApiClient.fetchEmergency(id as string, signal),
    intervalMs,
    [id],
    id !== null,
  );
}

/** 경로 조회. 경로는 생성 후 거의 바뀌지 않으므로 주기를 길게 둔다. */
export function useRoute(
  id: string | null,
  intervalMs: number,
): PollingResult<EmergencyRouteResponse> {
  return usePolling<EmergencyRouteResponse>(
    (signal) => ControlApiClient.fetchRoute(id as string, signal),
    intervalMs,
    [id],
    id !== null,
  );
}

/** 이벤트 전송 이력 조회. */
export function useEvents(
  id: string | null,
  intervalMs: number,
): PollingResult<EventLogResponse[]> {
  return usePolling<EventLogResponse[]>(
    (signal) => ControlApiClient.fetchEvents(id as string, signal),
    intervalMs,
    [id],
    id !== null,
  );
}

/**
 * 콘 영역 조회 (ConeLayer).
 * available=false는 Worker가 아직 계산하지 않은 것이지 긴급상황이 없는 게 아니다.
 */
export function useCone(
  id: string | null,
  intervalMs: number,
  enabled: boolean,
): PollingResult<ConeResponse> {
  return usePolling<ConeResponse>(
    (signal) => ControlApiClient.fetchCone(id as string, signal),
    intervalMs,
    [id],
    enabled && id !== null,
  );
}

/** 양보 알림 수신 차량 조회 (AlertHighlight). */
export function useAlertedVehicles(
  id: string | null,
  intervalMs: number,
  enabled: boolean,
): PollingResult<AlertedVehiclesResponse> {
  return usePolling<AlertedVehiclesResponse>(
    (signal) => ControlApiClient.fetchAlertedVehicles(id as string, signal),
    intervalMs,
    [id],
    enabled && id !== null,
  );
}
