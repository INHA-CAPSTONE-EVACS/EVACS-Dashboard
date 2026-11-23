/**
 * 진행 중인 긴급상황 목록과 상태 (설계서 EmergencyListPanel).
 *
 * 설계서 함수: renderList(EmergencyListResponse)
 * 목록·상태 표시, 상태 필터, 항목 선택 시 Store 갱신.
 */
import type { EmergencyListResponse, EmergencyResponse, EmergencyStatus } from '../api/contracts';
import { useDashboardStore } from '../store/DashboardStore';
import { elapsed, emergencyTypeLabel, hhmmss } from '../utils/format';
import { Panel } from './Panel';

interface Props {
  list: EmergencyListResponse | null;
  statusFilter: EmergencyStatus | '';
  onStatusFilterChange: (value: EmergencyStatus | '') => void;
  error: string | null;
  busy: boolean;
  /** 지금 시각. 경과 시간을 같이 다시 그리려고 상위에서 내려준다. */
  now: number;
}

export function EmergencyListPanel({
  list,
  statusFilter,
  onStatusFilterChange,
  error,
  busy,
  now,
}: Props) {
  const selectedId = useDashboardStore((s) => s.selectedEmergencyId);
  const selectEmergency = useDashboardStore((s) => s.selectEmergency);
  const focusAt = useDashboardStore((s) => s.focusAt);

  const items = list?.emergencies ?? [];
  const active = items.filter((e) => e.status === 'ACTIVE').length;

  /** 항목 선택 시 Store 갱신 + 지도 이동. SUMO 긴급상황은 발생지가 없으므로 목적지로 이동한다. */
  function onSelect(e: EmergencyResponse) {
    selectEmergency(e.id === selectedId ? null : e.id);
    if (e.id === selectedId) return;
    const lat = e.originLat ?? e.destinationLat;
    const lng = e.originLng ?? e.destinationLng;
    if (lat != null && lng != null) {
      focusAt(lat, lng);
    }
  }

  return (
    <Panel
      title="긴급상황"
      meta={`진행 ${active} / 전체 ${items.length}`}
      error={error}
      busy={busy}
      actions={
        <div className="segmented" role="group" aria-label="상태 필터">
          {(
            [
              ['', '전체'],
              ['ACTIVE', '진행'],
              ['ENDED', '종료'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={statusFilter === value ? 'is-on' : ''}
              onClick={() => onStatusFilterChange(value)}
            >
              {label}
            </button>
          ))}
        </div>
      }
    >
      {items.length === 0 ? (
        <p className="empty">표시할 긴급상황이 없습니다.</p>
      ) : (
        <ul className="elist">
          {items.map((e) => (
            <li key={e.id}>
              <button
                type="button"
                className={`elist__row${e.id === selectedId ? ' is-selected' : ''}`}
                onClick={() => onSelect(e)}
              >
                <span
                  className={`dot dot--${e.status === 'ACTIVE' ? 'active' : 'ended'}`}
                  aria-hidden
                />
                <span className="elist__type">{emergencyTypeLabel(e.emergencyType)}</span>
                <span className="elist__vehicle mono">{e.vehicleId}</span>
                <span className="elist__time mono">
                  {e.status === 'ACTIVE'
                    ? elapsed(e.startedAt, now)
                    : hhmmss(e.endedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
