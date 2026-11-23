import { describe, expect, it } from 'vitest';
import type { VehicleResponse } from '../api/contracts';
import { VehicleMotion } from './VehicleMotion';

const vehicle = (change: Partial<VehicleResponse> = {}): VehicleResponse => ({
  vehicleId: 'car-1', vehicleType: 'NORMAL', longitude: 126.65, latitude: 37.445,
  speedMps: 10, headingDegrees: 0, laneIndex: 0, laneCount: 3,
  measuredAt: null, occurredAt: null, stale: false, ...change,
});

describe('차량 수신 좌표 보간', () => {
  it('첫 위치는 즉시 표시하고 다음 위치는 수신 간격 동안 선형 보간한 뒤 멈춘다', () => {
    const motion = new VehicleMotion();
    motion.ingest([vehicle()], 0);
    expect(motion.sample(0)[0].latitude).toBe(37.445);
    motion.ingest([vehicle({ latitude: 37.4451 })], 1000);
    expect(motion.sample(1000)[0].latitude).toBeCloseTo(37.445, 8);
    expect(motion.sample(1500)[0].latitude).toBeCloseTo(37.44505, 8);
    expect(motion.hasActiveMotion(1500)).toBe(true);
    expect(motion.sample(2000)[0].latitude).toBeCloseTo(37.4451, 8);
    expect(motion.sample(10000)[0].latitude).toBeCloseTo(37.4451, 8);
    expect(motion.hasActiveMotion(10000)).toBe(false);
  });
  it('새 패킷이 먼저 와도 현재 화면 위치에서 이어 움직인다', () => {
    const motion = new VehicleMotion();
    motion.ingest([vehicle()], 0);
    motion.ingest([vehicle({ latitude: 37.4451 })], 1000);
    const before = motion.sample(1400)[0].latitude;
    motion.ingest([vehicle({ latitude: 37.4452 })], 1400);
    expect(motion.sample(1400)[0].latitude).toBeCloseTo(before, 10);
    expect(motion.sample(1600)[0].latitude).toBeGreaterThan(before);
  });
  it('359도에서 1도로 바뀌면 최단 방향으로 회전한다', () => {
    const motion = new VehicleMotion();
    motion.ingest([vehicle({ headingDegrees: 359 })], 0);
    motion.ingest([vehicle({ headingDegrees: 1 })], 1000);
    const heading = motion.sample(1500)[0].headingDegrees;
    expect(Math.min(heading, 360 - heading)).toBeLessThan(0.01);
  });
  it('같은 배열이나 동일 측정값 재수신은 진행 중인 이동을 재시작하지 않는다', () => {
    const motion = new VehicleMotion();
    motion.ingest([vehicle()], 0);
    const next = [vehicle({ latitude: 37.4451 })];
    motion.ingest(next, 1000);
    motion.ingest(next, 1300);
    motion.ingest([vehicle({ latitude: 37.4451 })], 1500);
    expect(motion.sample(2000)[0].latitude).toBeCloseTo(37.4451, 8);
    expect(motion.hasActiveMotion(2000)).toBe(false);
  });
  it('차량 ID로 이어 붙이고 한두 주기 빠진 차량은 유예 뒤 제거한다', () => {
    const motion = new VehicleMotion();
    motion.ingest([vehicle(), vehicle({ vehicleId: 'car-2' })], 0);
    motion.ingest([vehicle({ vehicleId: 'car-2', latitude: 37.4451 })], 1000);
    // car-1은 빠졌지만 유예 안이라 마지막 위치를 유지한다.
    expect(motion.sample(1500).map((v) => v.vehicleId).sort()).toEqual(['car-1', 'car-2']);
    expect(motion.sample(1500)[1].latitude).toBeCloseTo(37.44505, 8);
    motion.ingest([], 2000);
    expect(motion.sample(2000).map((v) => v.vehicleId)).toEqual(['car-1', 'car-2']);
    motion.ingest([], 5000);
    expect(motion.sample(5000)).toEqual([]);
  });
  it('빠졌다 돌아온 차량은 새로 생기지 않고 마지막 위치에서 이어 움직인다', () => {
    const motion = new VehicleMotion();
    motion.ingest([vehicle({ measuredAt: '2026-11-19T00:00:00Z' })], 0);
    motion.ingest([], 1000);
    motion.ingest([vehicle({ measuredAt: '2026-11-19T00:00:02Z', latitude: 37.4452 })], 2000);
    // 측정 간격 2초 동안 보간한다. 돌아오자마자 순간이동하지 않는다.
    expect(motion.sample(2000)[0].latitude).toBeCloseTo(37.445, 8);
    expect(motion.sample(3000)[0].latitude).toBeCloseTo(37.4451, 8);
    expect(motion.sample(4000)[0].latitude).toBeCloseTo(37.4452, 8);
  });
  it('측정 시각 간격이 조회 주기보다 길면 그 간격 동안 보간한다', () => {
    const motion = new VehicleMotion();
    motion.ingest([vehicle({ measuredAt: '2026-11-19T00:00:00Z' })], 0);
    // 같은 측정값을 여러 번 받아도 다음 이동 길이가 짧아지지 않는다.
    motion.ingest([vehicle({ measuredAt: '2026-11-19T00:00:00Z' })], 1000);
    motion.ingest([vehicle({ measuredAt: '2026-11-19T00:00:03Z', latitude: 37.4453 })], 2000);
    expect(motion.sample(3500)[0].latitude).toBeCloseTo(37.44515, 8);
    expect(motion.hasActiveMotion(4500)).toBe(true);
    expect(motion.sample(5000)[0].latitude).toBeCloseTo(37.4453, 8);
    expect(motion.hasActiveMotion(5000)).toBe(false);
  });
  it('이전 측정 시각 패킷은 무시하지만 stale 상태는 표시한다', () => {
    const motion = new VehicleMotion();
    motion.ingest([vehicle({ measuredAt: '2026-11-19T00:00:02Z' })], 0);
    motion.ingest([vehicle({ measuredAt: '2026-11-19T00:00:01Z', latitude: 37.446 })], 1000);
    expect(motion.sample(1000)[0].latitude).toBe(37.445);
    motion.ingest([vehicle({ measuredAt: '2026-11-19T00:00:02Z', stale: true })], 2000);
    expect(motion.sample(2000)[0].stale).toBe(true);
    expect(motion.hasActiveMotion(2000)).toBe(false);
  });
  it('재접속·장거리 점프는 도로를 가로지르는 가짜 주행으로 보간하지 않는다', () => {
    const motion = new VehicleMotion();
    motion.ingest([vehicle()], 0);
    motion.ingest([vehicle({ latitude: 37.5 })], 1000);
    expect(motion.sample(1000)[0].latitude).toBe(37.5);
    expect(motion.hasActiveMotion(1000)).toBe(false);
    motion.ingest([vehicle({ latitude: 37.5001 })], 10000);
    expect(motion.sample(10000)[0].latitude).toBe(37.5001);
  });
});
