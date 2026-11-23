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

interface DashboardState {
  selectedEmergencyId: string | null;
  viewport: { bbox: Bbox | null; zoom: number };
  layerVisibility: LayerVisibility;
  vehicleTypeFilter: VehicleTypeFilter;

  /** 지도 좌표 선택 모드 (EmergencyCreateControl이 켠다) */
  selectMode: boolean;
  /** 선택 모드에서 지도를 눌러 찍은 좌표 */
  pickedPoint: { latitude: number; longitude: number } | null;

  /** focusEmergency() 요청. 지도는 이 값이 바뀔 때만 카메라를 옮긴다. */
  focusTarget: { latitude: number; longitude: number; at: number } | null;

  /** 차량뷰로 추적 중인 차량. null이면 추적하지 않는다. */
  trackedVehicleId: string | null;

  selectEmergency: (id: string | null) => void;
  setViewport: (bbox: Bbox, zoom: number) => void;
  toggleLayer: (key: LayerKey) => void;
  setVehicleTypeFilter: (value: VehicleTypeFilter) => void;
  enterSelectMode: () => void;
  exitSelectMode: () => void;
  pickPoint: (latitude: number, longitude: number) => void;
  clearPickedPoint: () => void;
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
  selectMode: false,
  pickedPoint: null,
  trackedVehicleId: null,
  focusTarget: null,

  selectEmergency: (id) => set({ selectedEmergencyId: id }),

  setViewport: (bbox, zoom) => set({ viewport: { bbox, zoom } }),

  toggleLayer: (key) =>
    set((s) => ({
      layerVisibility: { ...s.layerVisibility, [key]: !s.layerVisibility[key] },
    })),

  setVehicleTypeFilter: (value) => set({ vehicleTypeFilter: value }),

  enterSelectMode: () => set({ selectMode: true }),

  exitSelectMode: () => set({ selectMode: false }),

  pickPoint: (latitude, longitude) =>
    set({ pickedPoint: { latitude, longitude }, selectMode: false }),

  clearPickedPoint: () => set({ pickedPoint: null }),

  focusAt: (latitude, longitude) =>
    set({ focusTarget: { latitude, longitude, at: Date.now() } }),

  trackVehicle: (vehicleId) =>
    set((s) => ({ trackedVehicleId: s.trackedVehicleId === vehicleId ? null : vehicleId })),
}));
