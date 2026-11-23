/**
 * 선택한 긴급상황의 상세·경로·이벤트 이력 (설계서 EmergencyDetailPanel).
 *
 * 설계서 함수: renderDetail(EmergencyResponse), renderRoute(EmergencyRouteResponse),
 * renderEvents(EventLogResponse[]).
 * 경로 폴리라인 자체는 지도(ControlMapView)가 그리고, 여기서는 요약·예상 소요 시간을 보여준다.
 */
import type {
  AlertedVehiclesResponse,
  ConeResponse,
  EmergencyResponse,
  EmergencyRouteResponse,
  EventLogResponse,
} from '../api/contracts';
import { elapsed, emergencyTypeLabel, num, stamp } from '../utils/format';
import { useDashboardStore } from '../store/DashboardStore';
import { Panel } from './Panel';

interface Props {
  emergency: EmergencyResponse | null;
  route: EmergencyRouteResponse | null;
  events: EventLogResponse[] | null;
  cone: ConeResponse | null;
  alerted: AlertedVehiclesResponse | null;
  error: string | null;
  busy: boolean;
  now: number;
  onEnd: (id: string) => void;
  ending: boolean;
}

export function EmergencyDetailPanel({
  emergency,
  route,
  events,
  cone,
  alerted,
  error,
  busy,
  now,
  onEnd,
  ending,
}: Props) {
  const trackedVehicleId = useDashboardStore((s) => s.trackedVehicleId);
  const trackVehicle = useDashboardStore((s) => s.trackVehicle);
  const focusAt = useDashboardStore((s) => s.focusAt);

  if (!emergency) {
    return (
      <Panel title="상세">
        <p className="empty">좌측 목록에서 긴급상황을 선택하십시오.</p>
      </Panel>
    );
  }

  const eta = route?.points.at(-1)?.etaSeconds ?? null;
  const tracked = trackedVehicleId === emergency.vehicleId;
  const pinLat = emergency.destinationLat ?? emergency.originLat;
  const pinLng = emergency.destinationLng ?? emergency.originLng;

  return (
    <Panel
      title="상세"
      meta={emergency.status === 'ACTIVE' ? '진행' : '종료'}
      error={error}
      busy={busy}
      actions={
        <>
          {pinLat != null && pinLng != null ? (
            <button type="button" className="btn" onClick={() => focusAt(pinLat, pinLng)}>
              위치 보기
            </button>
          ) : null}
          <button
            type="button"
            className={`btn${tracked ? ' is-on' : ''}`}
            aria-pressed={tracked}
            onClick={() => trackVehicle(emergency.vehicleId)}
          >
            {tracked ? '추적 해제' : '차량 추적'}
          </button>
          {emergency.status === 'ACTIVE' ? (
            <button
              type="button"
              className="btn btn--danger"
              disabled={ending}
              onClick={() => onEnd(emergency.id)}
            >
              {ending ? '종료 중' : '긴급상황 종료'}
            </button>
          ) : null}
        </>
      }
    >
      {/* renderDetail: 유형·상태·접수/종료 시각 */}
      <dl className="kv">
        <div>
          <dt>식별자</dt>
          <dd className="mono kv__id">{emergency.id}</dd>
        </div>
        <div>
          <dt>유형</dt>
          <dd>{emergencyTypeLabel(emergency.emergencyType)}</dd>
        </div>
        <div>
          <dt>차량</dt>
          <dd className="mono">{emergency.vehicleId}</dd>
        </div>
        <div>
          <dt>접수</dt>
          <dd className="mono">{stamp(emergency.startedAt)}</dd>
        </div>
        <div>
          <dt>{emergency.status === 'ACTIVE' ? '경과' : '종료'}</dt>
          <dd className="mono">
            {emergency.status === 'ACTIVE'
              ? elapsed(emergency.startedAt, now)
              : stamp(emergency.endedAt)}
          </dd>
        </div>
        <div>
          <dt>모드</dt>
          <dd>{emergency.isSumo ? 'SUMO 투입' : '실차'}</dd>
        </div>
        <div>
          <dt>발생지</dt>
          <dd className="mono">{coord(emergency.originLat, emergency.originLng)}</dd>
        </div>
        <div>
          <dt>목적지</dt>
          <dd className="mono">
            {coord(emergency.destinationLat, emergency.destinationLng)}
          </dd>
        </div>
      </dl>

      {emergency.description ? (
        <p className="detail-note">{emergency.description}</p>
      ) : null}

      {/* renderRoute: 경로 요약 + 예상 소요 시간 */}
      <div className="subhead">경로 · 영향 영역</div>
      <dl className="kv kv--tight">
        <div>
          <dt>경로 지점</dt>
          <dd className="mono">{route ? num(route.pointCount) : '-'}</dd>
        </div>
        <div>
          <dt>예상 소요</dt>
          <dd className="mono">{eta != null ? `${num(eta)}s` : '-'}</dd>
        </div>
        <div>
          <dt>콘 셀</dt>
          <dd className="mono">
            {cone?.available ? num(cone.cells.length) : '미산출'}
          </dd>
        </div>
        <div>
          <dt>알림 수신</dt>
          <dd className="mono">{alerted ? num(alerted.count) : '-'}</dd>
        </div>
      </dl>

      {/* renderEvents: 이벤트 전송 이력 */}
      <div className="subhead">
        이벤트 이력 <span className="mono subhead__count">{events?.length ?? 0}</span>
      </div>
      {!events || events.length === 0 ? (
        <p className="empty">전송된 이벤트가 없습니다.</p>
      ) : (
        <ul className="eventlog">
          {events.map((ev) => (
            <li key={ev.id}>
              <span className="mono eventlog__time">{stamp(ev.occurredAt)}</span>
              <span className="eventlog__type">{ev.eventType}</span>
              <span className="mono eventlog__vehicle">{ev.vehicleId ?? '-'}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function coord(lat: number | null, lng: number | null): string {
  if (lat == null || lng == null) return '-';
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}
