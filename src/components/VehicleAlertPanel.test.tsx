// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { VehicleAlertListResponse } from '../api/contracts';
import { useDashboardStore } from '../store/DashboardStore';
import { VehicleAlertPanel } from './VehicleAlertPanel';

afterEach(() => {
  cleanup();
  useDashboardStore.setState({ trackedVehicleId: null });
});

function list(): VehicleAlertListResponse {
  return {
    count: 2,
    queriedAt: '2026-11-28T09:30:10.000Z',
    streamPolledAt: '2026-11-28T09:30:10.000Z',
    alerts: [
      {
        vehicleId: 'EVACS_CAR_000001',
        alertType: 'YIELD_ALERT_ISSUED',
        alertId: 'ALT-1',
        alertVersion: 1,
        dispatchId: 'DSP-001',
        approachDirection: 'REAR',
        recommendedAction: 'YIELD_WHEN_SAFE',
        message: '후방에서 긴급차량이 접근하고 있습니다.',
        reason: null,
        occurredAt: '2026-11-28T09:30:00.000Z',
        expiresAt: '2026-11-28T09:30:20.000Z',
        eventId: 'evt-1',
      },
      {
        vehicleId: 'EVACS_CAR_000002',
        alertType: 'EMERGENCY_ROUTE_UPDATED',
        alertId: null,
        alertVersion: null,
        dispatchId: 'DSP-001',
        approachDirection: null,
        recommendedAction: null,
        message: '긴급차량 경로가 변경되었습니다.',
        reason: null,
        occurredAt: '2026-11-28T09:29:50.000Z',
        expiresAt: null,
        eventId: 'evt-2',
      },
    ],
  };
}

it('차량별로 어떤 알람이 왔는지와 안내 문구를 보여 준다', () => {
  render(<VehicleAlertPanel alerts={list()} error={null} busy={false} now={Date.now()} />);

  expect(screen.getByText('EVACS_CAR_000001')).toBeTruthy();
  expect(screen.getByText('양보 요청 · 후방')).toBeTruthy();
  expect(screen.getByText('후방에서 긴급차량이 접근하고 있습니다.')).toBeTruthy();
  // 양보 알림만이 아니라 경로 변경 알림도 같은 목록에 보인다.
  expect(screen.getByText('경로 변경')).toBeTruthy();
});

it('알림이 없으면 비어 있다고 알린다', () => {
  render(
    <VehicleAlertPanel
      alerts={{ count: 0, alerts: [], queriedAt: '', streamPolledAt: null }}
      error={null}
      busy={false}
      now={Date.now()}
    />,
  );
  expect(screen.getByText('알림이 떠 있는 차량이 없습니다.')).toBeTruthy();
});

it('항목을 누르면 그 차량 추적을 켠다', () => {
  render(<VehicleAlertPanel alerts={list()} error={null} busy={false} now={Date.now()} />);

  fireEvent.click(screen.getByText('EVACS_CAR_000002'));
  expect(useDashboardStore.getState().trackedVehicleId).toBe('EVACS_CAR_000002');

  fireEvent.click(screen.getByText('EVACS_CAR_000002'));
  expect(useDashboardStore.getState().trackedVehicleId).toBeNull();
});
