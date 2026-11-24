/**
 * 화면 전체가 공유하는 상태 (설계서 DashboardStore).
 *
 * 상태: selectedEmergencyId, viewport(bbox, zoom), layerVisibility.
 * 패널 간 선택 전달은 전부 여기를 거친다 — 패널끼리 직접 참조하지 않는다.
 */
import { create } from 'zustand';
import type { Bbox } from '../api/contracts';

export type LayerKey = 'vehicles' | 'cone' | 'heatmap' | 'alerts' | 'route' | 'trail' | 'pins';

export type LayerVisibility = Record<LayerKey, boolean>;

/** 차량 조회 필터. 빈 문자열이면 전체 유형. */
export type VehicleTypeFilter = '' | 'NORMAL' | 'EMERGENCY';

/** 지도에서 찍는 대상. 긴급상황 접수는 출발지·목적지 둘을 따로 찍는다. */
export type PickTarget = 'origin' | 'destination';

export interface PickedPoint {
  latitude: number;
  longitude: number;
}

interface DashboardState {
  selectedEmergencyId: string | null;
  viewport: { bbox: Bbox | null; zoom: number };
  layerVisibility: LayerVisibility;
  vehicleTypeFilter: VehicleTypeFilter;

  /** 지도 좌표 선택 모드. null이면 선택 중이 아니다 (EmergencyCreateControl이 켠다). */
  selectMode: PickTarget | null;
  /** 선택 모드에서 찍은 좌표. 출발지는 지정하지 않으면 null(= 시나리오 차고지 출발). */
  pickedPoints: Record<PickTarget, PickedPoint | null>;

  /** focusEmergency() 요청. 지도는 이 값이 바뀔 때만 카메라를 옮긴다. */
  focusTarget: { latitude: number; longitude: number; at: number } | null;

  /** 차량뷰로 추적 중인 차량. null이면 추적하지 않는다. */
  trackedVehicleId: string | null;

  selectEmergency: (id: string | null) => void;
  setViewport: (bbox: Bbox, zoom: number) => void;
  toggleLayer: (key: LayerKey) => void;
  setVehicleTypeFilter: (value: VehicleTypeFilter) => void;
  /** 같은 대상을 다시 주면 선택 모드를 끈다(토글). */
  enterSelectMode: (target: PickTarget) => void;
  exitSelectMode: () => void;
  pickPoint: (latitude: number, longitude: number) => void;
  clearPickedPoint: (target?: PickTarget) => void;
  focusAt: (latitude: number, longitude: number) => void;
  /** 같은 차량을 다시 주면 추적을 끈다(토글). */
  trackVehicle: (vehicleId: string | null) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  selectedEmergencyId: null,
  viewport: { bbox: null, zoom: 13 },
  layerVisibility: {
    vehicles: true,
    cone: true,
    heatmap: false,
    alerts: true,
    route: true,
    trail: false,
    pins: true,
  },
  vehicleTypeFilter: '',
  selectMode: null,
  pickedPoints: { origin: null, destination: null },
  trackedVehicleId: null,
  focusTarget: null,

  selectEmergency: (id) => set({ selectedEmergencyId: id }),

  setViewport: (bbox, zoom) => set({ viewport: { bbox, zoom } }),

  toggleLayer: (key) =>
    set((s) => ({
      layerVisibility: { ...s.layerVisibility, [key]: !s.layerVisibility[key] },
    })),

  setVehicleTypeFilter: (value) => set({ vehicleTypeFilter: value }),

  enterSelectMode: (target) =>
    set((s) => ({ selectMode: s.selectMode === target ? null : target })),

  exitSelectMode: () => set({ selectMode: null }),

  pickPoint: (latitude, longitude) =>
    set((s) => (s.selectMode === null ? s : {
      pickedPoints: { ...s.pickedPoints, [s.selectMode]: { latitude, longitude } },
      selectMode: null,
    })),

  clearPickedPoint: (target) =>
    set((s) => ({
      pickedPoints: target
        ? { ...s.pickedPoints, [target]: null }
        : { origin: null, destination: null },
    })),

  focusAt: (latitude, longitude) =>
    set({ focusTarget: { latitude, longitude, at: Date.now() } }),

  trackVehicle: (vehicleId) =>
    set((s) => ({ trackedVehicleId: s.trackedVehicleId === vehicleId ? null : vehicleId })),
}));
