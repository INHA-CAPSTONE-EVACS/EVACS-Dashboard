// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, StrictMode } from 'react';
import type { EmergencyResponse, VehicleResponse } from '../api/contracts';
const calls = vi.hoisted(() => ({ setProps: vi.fn(), easeTo: vi.fn(), jumpTo: vi.fn(), boundsReady: true, active: null as null | { setProps: (props: unknown) => void }, attachedProps: null as null | { layers: { id: string; props: { visible: boolean } }[] } }));
vi.mock('@deck.gl/mapbox', () => ({ MapboxOverlay: class { setProps(props: unknown) { calls.setProps(props); if (calls.active === this) calls.attachedProps = props as typeof calls.attachedProps; } } }));
vi.mock('react-map-gl/maplibre', async () => {
  const { useImperativeHandle } = await import('react');
  const map = {
    addControl: (control: NonNullable<typeof calls.active>) => { calls.active = control; },
    removeControl: () => { calls.active = null; },
    hasControl: (control: NonNullable<typeof calls.active>) => calls.active === control,
  };
  return {
    useMap: () => ({ current: map }),
    Map: ({ children, ref }: { children: React.ReactNode; ref: React.Ref<unknown> }) => {
      useImperativeHandle(ref, () => ({
        easeTo: calls.easeTo,
        jumpTo: calls.jumpTo,
        getZoom: () => 15,
        getBearing: () => 0,
        getCenter: () => ({ lng: 126.65, lat: 37.44 }),
        getBounds: () => (calls.boundsReady ? { getSouth: () => 37.44, getNorth: () => 37.45, getWest: () => 126.64, getEast: () => 126.66 } : undefined),
      }));
      return createElement('div', null, children);
    },
  };
});
import { ControlMapView } from './ControlMapView';
import { useDashboardStore } from '../store/DashboardStore';

/** 지도 컴포넌트의 필수 props 기본값. 각 테스트는 필요한 것만 덮어쓴다. */
const mapProps = {
  vehicles: [], previousVehicles: [], cone: null, alertedVehicleIds: [], route: null, dispatchRoute: null,
  densityCells: {}, trailVehicleId: null, emergencies: [], selectedEmergencyId: null,
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  calls.boundsReady = true;
  useDashboardStore.setState({ trackedVehicleId: null, viewport: { bbox: null, zoom: 13 } });
});

it('조회 영역(bbox)을 Store로 보내고, 지도가 준비되기 전이면 다시 시도한다', () => {
  // bbox가 안 나가면 차량·밀도(H3 셀) 조회 자체가 돌지 않아 화면이 비어 보인다.
  vi.useFakeTimers();
  calls.boundsReady = false;
  render(<ControlMapView {...mapProps} />);
  act(() => { vi.advanceTimersByTime(1000); });
  expect(useDashboardStore.getState().viewport.bbox).toBeNull();

  calls.boundsReady = true;
  act(() => { vi.advanceTimersByTime(400); });
  expect(useDashboardStore.getState().viewport.bbox).toEqual({
    minLat: 37.44, maxLat: 37.45, minLng: 126.64, maxLng: 126.66,
  });
});

it('차선 상세 토글을 실제 오버레이에 전달하고 초기 위치로 복귀한다', async () => {
  render(<ControlMapView {...mapProps} />);
  const layer = () => calls.setProps.mock.lastCall?.[0].layers.find((x: { id: string }) => x.id === 'inha-road-tiles');
  expect(layer().props.visible).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '차선 상세' }));
  expect(layer().props.visible).toBe(false);
  expect(screen.getByRole('status').textContent).toBe('차선 상세 숨김');
  fireEvent.click(screen.getByRole('button', { name: '차선 상세' }));
  expect(layer().props.visible).toBe(true);
  layer().props.onTileLoad({});
  await waitFor(() => expect(screen.getByRole('status').textContent).toBe('SUMO 도로망 · 3D Tiles'));
  fireEvent.click(screen.getByRole('button', { name: '기준 교차로' }));
  expect(calls.easeTo).toHaveBeenCalledWith(expect.objectContaining({ center: [126.65048, 37.4454], pitch: 45 }));
  fireEvent.click(screen.getByRole('button', { name: '광역 보기' }));
  expect(calls.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ center: [126.6545, 37.449], zoom: 14.6 }));
});

it('StrictMode 재마운트 이후에도 지도에 부착된 오버레이가 토글을 받는다', () => {
  render(<StrictMode><ControlMapView {...mapProps} /></StrictMode>);
  expect(calls.active).not.toBeNull();
  expect(calls.attachedProps?.layers.find((l) => l.id === 'inha-road-tiles')?.props.visible).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '차선 상세' }));
  expect(calls.attachedProps?.layers.find((l) => l.id === 'inha-road-tiles')?.props.visible).toBe(false);
});

it('긴급상황 목적지에 핀을 찍는다', () => {
  const emergency: EmergencyResponse = {
    id: 'e1', vehicleId: 'EVACS_EMG_CALL_001', status: 'ACTIVE', emergencyType: 'FIRE',
    originLat: null, originLng: null, destinationLat: 37.4477, destinationLng: 126.6532,
    description: null, startedAt: null, endedAt: null, isSumo: true,
  };
  render(<ControlMapView {...mapProps} emergencies={[emergency]} selectedEmergencyId="e1" />);
  const pins = calls.setProps.mock.lastCall?.[0].layers.find((l: { id: string }) => l.id === 'emergency-pin-layer');
  expect(pins.props.visible).toBe(true);
  expect(pins.props.data).toEqual([expect.objectContaining({ id: 'e1', latitude: 37.4477, longitude: 126.6532 })]);
  expect(pins.props.getPosition(pins.props.data[0])).toEqual([126.6532, 37.4477]);
});

it('워커가 바꾼 경로를 접수 경로와 별도 레이어로 그린다', () => {
  // available=false(워커 미산출)일 때 레이어가 생기면 "안 바뀐 경로"가 그려진 것처럼 보인다.
  const dispatchRoute = {
    dispatchId: 'e1', available: true, routeId: 'r1', routeVersion: 2,
    coordinates: [{ latitude: 37.4454, longitude: 126.6505 }, { latitude: 37.4464, longitude: 126.6515 }],
    coordinatesParsed: true, roadSegments: ['edge-a'], estimatedDuration: 240,
    changeReason: 'CONGESTION', createdAt: null,
  };
  const layerIds = () => calls.setProps.mock.lastCall?.[0].layers.map((l: { id: string }) => l.id);

  render(<ControlMapView {...mapProps} dispatchRoute={{ ...dispatchRoute, available: false, coordinates: [] }} />);
  expect(layerIds()).not.toContain('dispatch-route-layer');

  cleanup();
  render(<ControlMapView {...mapProps} dispatchRoute={dispatchRoute} />);
  const layer = calls.setProps.mock.lastCall?.[0].layers.find(
    (l: { id: string }) => l.id === 'dispatch-route-layer',
  );
  expect(layer.props.data[0].path).toEqual([[126.6505, 37.4454], [126.6515, 37.4464]]);
});

it('추적을 켜면 차량뷰로 맞추고 프레임마다 차량 좌표로 카메라를 옮긴다', () => {
  const car: VehicleResponse = {
    vehicleId: 'EVACS_EMG_CALL_001', vehicleType: 'EMERGENCY', longitude: 126.6505, latitude: 37.4454,
    speedMps: 12, headingDegrees: 90, stale: false, laneIndex: 0, laneCount: 2, measuredAt: null, occurredAt: null,
  };
  render(<ControlMapView {...mapProps} vehicles={[car]} />);
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
  act(() => { useDashboardStore.getState().trackVehicle('EVACS_EMG_CALL_001'); });

  // 좌표를 받은 첫 프레임: 차량 위치로 줌 17 이상(차량 3D 모델 조건) + 기울기 있는 차량뷰.
  const view = calls.easeTo.mock.lastCall?.[0];
  expect(view.center).toEqual([126.6505, 37.4454]);
  expect(view.zoom).toBeGreaterThanOrEqual(17);
  expect(view.pitch).toBeGreaterThan(1);

  // 진입 애니메이션 중에는 카메라를 건드리지 않는다(jumpTo가 easeTo를 취소한다).
  act(() => { useDashboardStore.setState({ layerVisibility: { ...useDashboardStore.getState().layerVisibility } }); });
  expect(calls.jumpTo).not.toHaveBeenCalled();

  // 진입이 끝나면 React 재렌더 없이 오버레이 rAF에서 jumpTo로 따라간다.
  clock.mockReturnValue(5000);
  act(() => { useDashboardStore.setState({ layerVisibility: { ...useDashboardStore.getState().layerVisibility } }); });
  expect(calls.jumpTo).toHaveBeenCalledWith(expect.objectContaining({ center: [126.6505, 37.4454] }));

  fireEvent.click(screen.getByRole('button', { name: '추적 해제' }));
  expect(useDashboardStore.getState().trackedVehicleId).toBeNull();
});
