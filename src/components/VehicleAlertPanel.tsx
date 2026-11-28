/**
 * 차량별 알림 현황 패널.
 *
 * "어떤 차량에 알람이 왔는지 / 어떤 알람인지"를 한 화면에서 바로 읽는 곳이다.
 * 출처는 `GET /control/vehicles/alerts` — 관제서버가 `evacs:stream:yield-alert`를 따라 읽어
 * 만든 현재 상태다. 긴급상황을 고르지 않아도 보인다(긴급상황별 수신 확인 집합과 다른 자원).
 *
 * 항목을 누르면 그 차량으로 지도를 옮기고 추적을 켠다 — 알림을 보고 바로 그 차를 찾아야 한다.
 */
import type { VehicleAlertListResponse, VehicleAlertResponse } from '../api/contracts';
import { useDashboardStore } from '../store/DashboardStore';
import { elapsed, hhmmss } from '../utils/format';
import { Panel } from './Panel';

interface Props {
  alerts: VehicleAlertListResponse | null;
  error: string | null;
  busy: boolean;
  /** 지금 시각. 경과 시간을 같이 다시 그리려고 상위에서 내려준다. */
  now: number;
}

/** 알림 종류 표기. 모르는 값은 서버가 준 코드를 그대로 보여 준다. */
const ALERT_TYPE_LABEL: Record<string, string> = {
  YIELD_ALERT_ISSUED: '양보 요청',
  EMERGENCY_ROUTE_UPDATED: '경로 변경',
  YIELD_ALERT_CLEARED: '해제',
};

const DIRECTION_LABEL: Record<string, string> = {
  REAR: '후방',
  FRONT: '전방',
  LEFT: '좌측',
  RIGHT: '우측',
  ONCOMING: '대향',
};

export function VehicleAlertPanel({ alerts, error, busy, now }: Props) {
  const trackedVehicleId = useDashboardStore((s) => s.trackedVehicleId);
  const trackVehicle = useDashboardStore((s) => s.trackVehicle);

  const items = alerts?.alerts ?? [];

  return (
    <Panel
      title="차량 알림"
      meta={`${items.length}대 · 갱신 ${hhmmss(alerts?.streamPolledAt ?? null)}`}
      error={error}
      busy={busy}
    >
      {items.length === 0 ? (
        <p className="empty">알림이 떠 있는 차량이 없습니다.</p>
      ) : (
        <ul className="alist">
          {items.map((alert) => (
            <li key={alert.vehicleId}>
              <button
                type="button"
                className={`alist__row${alert.vehicleId === trackedVehicleId ? ' is-selected' : ''}`}
                // Store의 trackVehicle은 같은 값이면 끄는 토글이다.
                onClick={() => trackVehicle(alert.vehicleId)}
              >
                <span className="dot dot--alert" aria-hidden />
                <span className="alist__type">{typeLabel(alert)}</span>
                <span className="alist__vehicle mono">{alert.vehicleId}</span>
                <span className="alist__time mono">{elapsed(alert.occurredAt, now)}</span>
                {alert.message ? <span className="alist__message">{alert.message}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** "양보 요청 · 후방" 처럼 종류와 접근 방향을 같이 보여 준다. */
function typeLabel(alert: VehicleAlertResponse): string {
  const type = ALERT_TYPE_LABEL[alert.alertType] ?? alert.alertType;
  const direction = alert.approachDirection
    ? (DIRECTION_LABEL[alert.approachDirection] ?? alert.approachDirection)
    : null;
  return direction ? `${type} · ${direction}` : type;
}
