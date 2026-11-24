// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CreateEmergencyDto, EmergencyResponse } from '../api/contracts';

const created: EmergencyResponse = {
  id: 'e1', vehicleId: 'EVACS_EMG_CALL_001', status: 'ACTIVE', emergencyType: 'FIRE',
  originLat: null, originLng: null, destinationLat: 37.4477, destinationLng: 126.6532,
  description: null, startedAt: null, endedAt: null, isSumo: true,
};
const calls = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('../api/ControlApiClient', () => ({
  ControlApiClient: { createEmergency: (dto: CreateEmergencyDto) => calls.create(dto) },
  ControlApiError: class extends Error {},
}));

import { EmergencyCreateControl } from './EmergencyCreateControl';
import { useDashboardStore } from '../store/DashboardStore';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useDashboardStore.setState({ selectMode: null, pickedPoints: { origin: null, destination: null } });
});

function fillForm() {
  fireEvent.change(screen.getByPlaceholderText('EVACS_EMG_CALL_001'), {
    target: { value: 'EVACS_EMG_CALL_001' },
  });
}

/** 지도 클릭 대신 Store의 pickPoint를 직접 부른다(지도는 같은 함수를 호출한다). */
function pick(target: 'origin' | 'destination', lat: number, lng: number) {
  act(() => {
    useDashboardStore.getState().enterSelectMode(target);
    useDashboardStore.getState().pickPoint(lat, lng);
  });
}

it('출발지를 지정하지 않으면 목적지만 보낸다(시나리오 차고지 출발)', async () => {
  calls.create.mockResolvedValue(created);
  render(<EmergencyCreateControl onCreated={() => {}} />);
  fillForm();
  pick('destination', 37.4477, 126.6532);

  fireEvent.click(screen.getByRole('button', { name: '접수' }));

  await waitFor(() => expect(calls.create).toHaveBeenCalledTimes(1));
  const dto = calls.create.mock.lastCall?.[0] as CreateEmergencyDto;
  expect(dto).toMatchObject({
    vehicleId: 'EVACS_EMG_CALL_001',
    destinationLat: 37.4477,
    destinationLng: 126.6532,
    isSumo: true,
  });
  expect(dto.originLat).toBeUndefined();
  expect(dto.originLng).toBeUndefined();
});

it('출발지를 지도에서 지정하면 originLat/Lng까지 보낸다', async () => {
  calls.create.mockResolvedValue(created);
  render(<EmergencyCreateControl onCreated={() => {}} />);
  fillForm();
  fireEvent.click(screen.getByRole('button', { name: '지도 지정' }));
  pick('origin', 37.4454, 126.6505);
  pick('destination', 37.4477, 126.6532);

  fireEvent.click(screen.getByRole('button', { name: '접수' }));

  await waitFor(() => expect(calls.create).toHaveBeenCalledTimes(1));
  expect(calls.create.mock.lastCall?.[0]).toMatchObject({
    originLat: 37.4454,
    originLng: 126.6505,
    destinationLat: 37.4477,
    destinationLng: 126.6532,
    isSumo: true,
  });
});

it('출발지 지정 모드인데 출발 좌표가 없으면 접수할 수 없다', () => {
  render(<EmergencyCreateControl onCreated={() => {}} />);
  fillForm();
  pick('destination', 37.4477, 126.6532);
  const submit = () => screen.getByRole('button', { name: '접수' }) as HTMLButtonElement;
  expect(submit().disabled).toBe(false);

  fireEvent.click(screen.getByRole('button', { name: '지도 지정' }));
  expect(submit().disabled).toBe(true);
  expect(calls.create).not.toHaveBeenCalled();
});
