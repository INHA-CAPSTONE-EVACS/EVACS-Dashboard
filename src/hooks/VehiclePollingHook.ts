/**
 * 차량 목록 주기 조회 및 변경분 반영 (설계서 VehiclePollingHook).
 *
 * 표시 영역(bbox)과 차량 유형 조건으로 주기 조회한다.
 * 변경분 계산(applyDiff)은 VehicleLayer가 하고, 여기서는 "직전 응답"만 같이 돌려준다.
 */
import { useRef } from 'react';
import { ControlApiClient } from '../api/ControlApiClient';
import type {
  Bbox,
  DensityResponse,
  VehicleListResponse,
  VehicleResponse,
  VehicleSummaryResponse,
} from '../api/contracts';
import { usePolling, type PollingResult } from './usePolling';

export interface VehiclesResult extends PollingResult<VehicleListResponse> {
  /** 현재 표시 중인 차량들 */
  vehicles: VehicleResponse[];
  /** 직전 주기의 차량들. VehicleLayer.applyDiff(previous, current)에 그대로 넘긴다. */
  previous: VehicleResponse[];
}

/** 표시 영역과 유형 조건으로 차량 목록을 주기 조회한다. */
export function useVehicles(
  bbox: Bbox | null,
  vehicleType: string,
  intervalMs: number,
): VehiclesResult {
  const previousRef = useRef<VehicleResponse[]>([]);
  const lastSeenRef = useRef<VehicleListResponse | null>(null);

  const result = usePolling<VehicleListResponse>(
    (signal) =>
      ControlApiClient.fetchVehicles(
        { ...(bbox ?? {}), vehicleType: vehicleType || undefined },
        signal,
      ),
    intervalMs,
    [bbox?.minLat, bbox?.maxLat, bbox?.minLng, bbox?.maxLng, vehicleType],
    bbox !== null,
  );

  // data가 새 객체로 바뀐 순간의 직전 값을 previous로 남긴다.
  if (result.data && result.data !== lastSeenRef.current) {
    previousRef.current = lastSeenRef.current?.vehicles ?? [];
    lastSeenRef.current = result.data;
  }

  return {
    ...result,
    vehicles: result.data?.vehicles ?? [],
    previous: previousRef.current,
  };
}

/**
 * 추적 중인 차량 한 대를 ID로 직접 조회한다.
 *
 * 목록 조회는 표시 영역(bbox)에 묶여 있어서, 화면 밖 차량은 애초에 응답에 들어오지 않는다.
 * 추적을 시작한 순간 그 차량이 화면 밖이면 좌표를 영영 못 받으므로 단건 조회로 따로 가져온다.
 */
export function useTrackedVehicle(
  vehicleId: string | null,
  intervalMs: number,
): PollingResult<VehicleResponse> {
  return usePolling<VehicleResponse>(
    (signal) => ControlApiClient.fetchVehicle(vehicleId ?? '', signal),
    intervalMs,
    [vehicleId],
    vehicleId !== null,
  );
}

/** 전체·유형별 활성 차량 수 조회. */
export function useVehicleSummary(
  intervalMs: number,
): PollingResult<VehicleSummaryResponse> {
  return usePolling<VehicleSummaryResponse>(
    (signal) => ControlApiClient.fetchVehicleSummary(signal),
    intervalMs,
    [],
  );
}

/** 셀별 차량 밀도 조회. HeatmapLayer가 켜져 있을 때만 돈다. */
export function useVehicleDensity(
  bbox: Bbox | null,
  vehicleType: string,
  resolution: number,
  intervalMs: number,
  enabled: boolean,
): PollingResult<DensityResponse> {
  return usePolling<DensityResponse>(
    (signal) =>
      ControlApiClient.fetchDensity(
        { ...(bbox ?? {}), vehicleType: vehicleType || undefined, resolution },
        signal,
      ),
    intervalMs,
    [bbox?.minLat, bbox?.maxLat, bbox?.minLng, bbox?.maxLng, vehicleType, resolution],
    enabled && bbox !== null,
  );
}
