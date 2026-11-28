// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { VehicleResponse } from '../api/contracts';
const state = vi.hoisted(() => ({ props: null as any, renderCount: 0, onMove: null as any }));
vi.mock('@deck.gl/mapbox', () => ({ MapboxOverlay: class { setProps(p: unknown) { state.props = p; } } }));
vi.mock('react-map-gl/maplibre', async () => {
  const { createElement, useImperativeHandle } = await import('react');
  const map = { addControl: () => {}, removeControl: () => {}, hasControl: () => true };
  return {
    useMap: () => ({ current: map }),
    Map: ({ children, ref, onMove }: any) => {
      state.renderCount++;
      state.onMove = onMove;
      useImperativeHandle(ref, () => ({ getBounds: () => ({ getSouth: () => 37.44, getNorth: () => 37.45, getWest: () => 126.64, getEast: () => 126.66 }) }));
      return createElement('div', null, children);
    },
  };
});
import { ControlMapView } from './ControlMapView';
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it('수신 사이 rAF로 실제 오버레이 모델과 알림을 보간하고 재렌더 없이 갱신한다', () => {
  const frames: FrameRequestCallback[] = [];
  vi.stubGlobal('requestAnimationFrame', vi.fn((f) => { frames.push(f); return frames.length; }));
  const cancel = vi.fn(); vi.stubGlobal('cancelAnimationFrame', cancel);
  const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
  const car: VehicleResponse = { vehicleId: 'car', vehicleType: 'NORMAL', longitude: 126.65, latitude: 37.445, speedMps: 10, headingDegrees: 0, stale: false, laneIndex: 0, laneCount: 3, measuredAt: null, occurredAt: null };
  const props = { previousVehicles: [], cone: null, alertedVehicleIds: ['car'], route: null, dispatchRoute: null, densityCells: {}, trailVehicleId: null, emergencies: [], selectedEmergencyId: null };
  const screen = render(<ControlMapView {...props} vehicles={[car]} />);
  // 초기 위치는 광역 보기라 차량이 점으로 나온다. 모델이 나오는 배율로 지도를 옮긴다.
  act(() => { state.onMove({ viewState: { longitude: 126.65, latitude: 37.445, zoom: 18.5, pitch: 45, bearing: 0 } }); });
  frames.length = 0;
  clock.mockReturnValue(1000);
  screen.rerender(<ControlMapView {...props} vehicles={[{ ...car, latitude: 37.4451 }]} />);
  expect(frames.length).toBeGreaterThan(0);
  const renders = state.renderCount;
  act(() => { frames.shift()!(1500); });
  const model = state.props.layers.find((l: any) => l.id === 'vehicle-model-normal');
  const alert = state.props.layers.find((l: any) => l.id === 'alert-highlight-layer');
  expect(model.props.data[0].latitude).toBeCloseTo(37.44505, 8);
  expect(alert.props.data[0].latitude).toBeCloseTo(model.props.data[0].latitude, 10);
  expect(state.renderCount).toBe(renders);
  screen.unmount();
  expect(cancel).toHaveBeenCalled();
});
