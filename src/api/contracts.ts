/**
 * 관제서버(evacs-api-server) DTO의 1:1 미러.
 *
 * 원본: evacs-api-server/src/main/java/com/evacs/control/{vehicle,emergency}/dto/*.java
 * 서버 DTO가 바뀌면 이 파일도 같이 바꾼다. 여기 없는 필드는 화면에서 쓰지 않는다.
 */

export type H3CellId = string;

/** 서버 VehicleType.from()이 받는 값. */
export type VehicleType = 'NORMAL' | 'EMERGENCY' | 'UNKNOWN';

export type EmergencyStatus = 'ACTIVE' | 'ENDED';

/** VehicleResponse.java */
export interface VehicleResponse {
  vehicleId: string;
  vehicleType: string;
  latitude: number;
  longitude: number;
  speedMps: number;
  headingDegrees: number;
  laneIndex: number | null;
  laneCount: number | null;
  measuredAt: string | null;
  occurredAt: string | null;
  stale: boolean;
}

/** VehicleListResponse.java */
export interface VehicleListResponse {
  count: number;
  vehicles: VehicleResponse[];
  queriedAt: string;
}

/** VehicleSummaryResponse.java */
export interface VehicleSummaryResponse {
  total: number;
  normal: number;
  emergency: number;
  unknown: number;
  stale: number;
  queriedAt: string;
}

/** DensityResponse.java */
export interface DensityResponse {
  resolution: number;
  cellCount: number;
  cells: DensityCell[];
  queriedAt: string;
}

export interface DensityCell {
  h3Index: H3CellId;
  centerLat: number;
  centerLng: number;
  vehicleCount: number;
  normalCount: number;
  emergencyCount: number;
}

/** EmergencyResponse.java */
export interface EmergencyResponse {
  id: string;
  vehicleId: string;
  status: EmergencyStatus;
  emergencyType: string;
  originLat: number | null;
  originLng: number | null;
  destinationLat: number | null;
  destinationLng: number | null;
  description: string | null;
  startedAt: string | null;
  endedAt: string | null;
  /** true면 SUMO 시뮬레이터에 투입된 긴급차량이다(실차가 아니다). */
  isSumo: boolean;
}

/** EmergencyListResponse.java */
export interface EmergencyListResponse {
  count: number;
  emergencies: EmergencyResponse[];
}

/** EmergencyRouteResponse.java */
export interface EmergencyRouteResponse {
  emergencyId: string;
  pointCount: number;
  points: EmergencyRoutePoint[];
}

export interface EmergencyRoutePoint {
  sequence: number;
  latitude: number;
  longitude: number;
  h3Index: H3CellId | null;
  etaSeconds: number | null;
}

/** EventLogResponse.java */
export interface EventLogResponse {
  id: string;
  eventType: string;
  vehicleId: string | null;
  payload: string | null;
  occurredAt: string;
}

/**
 * DispatchRouteResponse.java — Emergency Worker가 실제로 바꾼 최신 경로.
 *
 * `/route`(접수 때 받은 경로)와 다른 자원이다. available=false는 "워커가 아직 안 쌓음"이고,
 * coordinatesParsed=false는 저장된 좌표 JSON이 기대 형태가 아니라 서버가 비웠다는 뜻이다.
 */
export interface DispatchRouteResponse {
  dispatchId: string;
  available: boolean;
  routeId: string | null;
  routeVersion: number | null;
  coordinates: DispatchRouteCoordinate[];
  coordinatesParsed: boolean;
  roadSegments: string[];
  estimatedDuration: number | null;
  changeReason: string | null;
  createdAt: string | null;
}

export interface DispatchRouteCoordinate {
  latitude: number;
  longitude: number;
}

/** DispatchRouteHistoryResponse.java — 경로가 몇 번 바뀌었는지 보는 요약(버전 오름차순). */
export interface DispatchRouteHistoryResponse {
  dispatchId: string;
  count: number;
  versions: DispatchRouteVersion[];
}

export interface DispatchRouteVersion {
  routeVersion: number;
  coordinateCount: number;
  estimatedDuration: number;
  changeReason: string | null;
  createdAt: string | null;
}

/** ConeResponse.java — available=false는 "아직 계산 안 됨"이지 "긴급상황 없음"이 아니다. */
export interface ConeResponse {
  emergencyId: string;
  available: boolean;
  vehicleId: string | null;
  version: number;
  resolution: number | null;
  cells: ConeCell[];
  updatedAt: string | null;
}

export interface ConeCell {
  h3Index: H3CellId;
  centerLat: number;
  centerLng: number;
}

/** AlertedVehiclesResponse.java */
export interface AlertedVehiclesResponse {
  emergencyId: string;
  count: number;
  vehicleIds: string[];
}

/** VehicleQueryDto.java */
export interface VehicleQueryDto {
  minLat?: number;
  maxLat?: number;
  minLng?: number;
  maxLng?: number;
  vehicleType?: string;
  includeStale?: boolean;
}

/** DensityQueryDto.java */
export interface DensityQueryDto extends VehicleQueryDto {
  resolution?: number;
}

/** EmergencyQueryDto.java */
export interface EmergencyQueryDto {
  status?: EmergencyStatus;
  vehicleId?: string;
  from?: string;
  to?: string;
  limit?: number;
}

/** CreateEmergencyDto.java */
export interface CreateEmergencyDto {
  vehicleId: string;
  emergencyType: string;
  originLat?: number;
  originLng?: number;
  destinationLat?: number;
  destinationLng?: number;
  description?: string;
  route?: CreateRoutePoint[];
  /**
   * true면 SUMO 모드다. 서버가 커밋 후 시뮬레이터에
   * `POST /api/emergency {depotId,destinationLat,destinationLng,vehicleId}`로 긴급차량 1대를 투입한다.
   * destinationLat/Lng가 없으면 서버가 400으로 거절한다.
   */
  isSumo?: boolean;
  /** 출발 차고지 ID. 생략하면 서버 설정값(`EVACS_SUMO_DEPOT_ID`, SUMO 시나리오 차고지)을 쓴다. */
  sumoDepotId?: string;
}

export interface CreateRoutePoint {
  latitude: number;
  longitude: number;
  sequence?: number;
  etaSeconds?: number;
}

/** 지도 표시 영역. 서버 조회 조건의 minLat/maxLat/minLng/maxLng로 그대로 간다. */
export interface Bbox {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
}
