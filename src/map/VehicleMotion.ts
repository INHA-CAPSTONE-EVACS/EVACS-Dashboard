import type { VehicleResponse } from '../api/contracts';

interface Track {
  from: VehicleResponse;
  target: VehicleResponse;
  startedAt: number;
  duration: number;
  receivedAt: number;
  /** 좌표가 실제로 바뀐 마지막 수신 시각. 측정 시각이 없을 때 보간 길이의 기준이 된다. */
  movedAt: number;
  /** 응답에서 빠진 뒤 경과를 재는 시각. 0이면 이번 응답에 들어 있었다. */
  missingSince: number;
}

/**
 * 응답에서 빠진 차량을 바로 지우지 않고 버티는 시간.
 * 서버의 stale 제외나 bbox 경계 때문에 한두 주기 빠졌다 돌아오는 차량이
 * 새 트랙으로 다시 생기면 보간 없이 순간이동한다.
 */
const MISSING_GRACE_MS = 2500;
/** 보간 길이 상한. 시뮬레이션이 느려도 멈췄다 튀는 대신 느리게 이어 움직인다. */
const MAX_INTERPOLATION_MS = 5000;

const normalize = (angle: number) => ((angle % 360) + 360) % 360;
const angleDelta = (from: number, to: number) => ((to - from + 540) % 360) - 180;
const stamp = (v: VehicleResponse) => Date.parse(v.measuredAt ?? v.occurredAt ?? '');

/**
 * 두 측정 시각 사이의 이동을 그 측정 간격 동안 보간한다(최대 약 한 틱 지연).
 * 조회 주기가 아니라 서버가 좌표를 갱신한 간격을 기준으로 삼아야,
 * 갱신이 느릴 때 "한 번에 휙 가고 멈추는" 움직임이 생기지 않는다.
 * 수신 좌표 밖으로 외삽하지 않으며, 오래된 패킷/재접속/위치 점프는 별도 처리한다.
 * Date.now가 아닌 performance.now/rAF의 단조 시계를 사용한다.
 */
export class VehicleMotion {
  private tracks = new Map<string, Track>();
  private lastSnapshot: VehicleResponse[] | null = null;

  ingest(snapshot: VehicleResponse[], now: number): void {
    if (snapshot === this.lastSnapshot) return;
    this.lastSnapshot = snapshot;
    const present = new Set<string>();
    for (const next of snapshot) {
      if (!Number.isFinite(next.longitude) || !Number.isFinite(next.latitude) ||
          Math.abs(next.latitude) > 90 || Math.abs(next.longitude) > 180) continue;
      present.add(next.vehicleId);
      const target = { ...next, headingDegrees: normalize(Number.isFinite(next.headingDegrees) ? next.headingDegrees : 0) };
      const track = this.tracks.get(next.vehicleId);
      if (!track) {
        this.tracks.set(next.vehicleId, {
          from: target, target, startedAt: now, duration: 0,
          receivedAt: now, movedAt: now, missingSince: 0,
        });
        continue;
      }
      const oldStamp = stamp(track.target);
      const nextStamp = stamp(target);
      if (Number.isFinite(oldStamp) && Number.isFinite(nextStamp) && nextStamp < oldStamp) continue;
      const samePose = target.longitude === track.target.longitude && target.latitude === track.target.latitude &&
        target.headingDegrees === track.target.headingDegrees;
      // 응답 간격(idleGap)은 연결 끊김 판단에만 쓴다. 보간 길이는 측정 간격으로 잡는다.
      const idleGap = Math.max(0, now - track.receivedAt);
      track.receivedAt = now;
      if (samePose && !target.stale) {
        // 동일 측정값 재수신은 좌표 보간을 리셋하지 않는다. 유형/속도/차로 등은 갱신한다.
        track.target = target;
        continue;
      }
      const from = this.at(track, now);
      // 측정 시각이 있으면 그 간격이 실제 이동에 걸린 시간이다.
      // 없으면 좌표가 마지막으로 바뀐 뒤 흐른 시간으로 대신한다(조회 주기가 아니다).
      const measuredGap = Number.isFinite(oldStamp) && Number.isFinite(nextStamp) ? nextStamp - oldStamp : 0;
      const movedGap = Math.max(0, now - track.movedAt);
      const duration = Math.max(100, Math.min(MAX_INTERPOLATION_MS, measuredGap || movedGap || 1000));
      const latitudeMeters = (target.latitude - from.latitude) * 111320;
      const longitudeMeters = (target.longitude - from.longitude) * 111320 * Math.cos(from.latitude * Math.PI / 180);
      const distance = Math.hypot(latitudeMeters, longitudeMeters);
      const plausible = Math.max(80, Math.max(target.speedMps || 0, from.speedMps || 0) * duration / 1000 * 3);
      const snap = target.stale || from.stale || idleGap > 5000 || distance > plausible;
      this.tracks.set(next.vehicleId, {
        from: snap ? target : from, target, startedAt: now, duration: snap ? 0 : duration,
        receivedAt: now, movedAt: now, missingSince: 0,
      });
    }
    // 빠진 차량은 바로 지우지 않는다. 유예 안에 돌아오면 마지막 위치에서 이어 움직인다.
    for (const [id, track] of this.tracks) {
      if (present.has(id)) { track.missingSince = 0; continue; }
      if (!track.missingSince) track.missingSince = now;
      else if (now - track.missingSince > MISSING_GRACE_MS) this.tracks.delete(id);
    }
  }

  sample(now: number): VehicleResponse[] {
    return [...this.tracks.values()].map((track) => this.at(track, now));
  }

  hasActiveMotion(now: number): boolean {
    for (const track of this.tracks.values()) {
      if (track.duration > 0 && now < track.startedAt + track.duration) return true;
    }
    return false;
  }

  private at(track: Track, now: number): VehicleResponse {
    const t = track.duration === 0 ? 1 : Math.max(0, Math.min(1, (now - track.startedAt) / track.duration));
    if (t === 1) return track.target;
    return {
      ...track.target,
      longitude: track.from.longitude + (track.target.longitude - track.from.longitude) * t,
      latitude: track.from.latitude + (track.target.latitude - track.from.latitude) * t,
      headingDegrees: normalize(track.from.headingDegrees + angleDelta(track.from.headingDegrees, track.target.headingDegrees) * t),
    };
  }
}
