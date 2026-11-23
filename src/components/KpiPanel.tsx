/**
 * 알림 지연(p99), 처리량 실시간 표시 (설계서 KpiPanel).
 *
 * 확정 필요: 서버에 KPI 엔드포인트가 없어 지금 값은 대시보드가 관측한 REST 응답 지연이다.
 * 서버가 end-to-end 알림 지연을 내려주면 apiMetrics 대신 그 응답을 읽도록 이 파일만 바꾼다.
 */
import { useSyncExternalStore } from 'react';
import { apiMetrics, type KpiSnapshot } from '../api/apiMetrics';
import type { VehicleSummaryResponse } from '../api/contracts';
import { num } from '../utils/format';
import { Panel } from './Panel';

interface Props {
  summary: VehicleSummaryResponse | null;
}

export function KpiPanel({ summary }: Props) {
  const kpi = useSyncExternalStore(apiMetrics.subscribe, apiMetrics.getSnapshot);
  return <KpiView kpi={kpi} summary={summary} />;
}

/** 설계서 renderKpi(kpi) 자리. 표시 전용이라 스냅샷만 받는다. */
function KpiView({ kpi, summary }: { kpi: KpiSnapshot; summary: VehicleSummaryResponse | null }) {
  return (
    <Panel title="지표" meta={`최근 30초 · 표본 ${kpi.samples}`}>
      <div className="kpi">
        <Metric
          label="응답 지연 p99"
          value={num(kpi.p99)}
          unit="ms"
          level={level(kpi.p99, 400, 1000)}
        />
        <Metric label="응답 지연 p50" value={num(kpi.p50)} unit="ms" />
        <Metric label="처리량" value={kpi.throughput.toFixed(1)} unit="req/s" />
        <Metric
          label="실패율"
          value={(kpi.errorRate * 100).toFixed(1)}
          unit="%"
          level={level(kpi.errorRate, 0.01, 0.1)}
        />
      </div>

      <div className="subhead">차량 현황</div>
      <div className="kpi kpi--compact">
        <Metric label="전체" value={num(summary?.total)} />
        <Metric label="일반" value={num(summary?.normal)} />
        <Metric label="긴급" value={num(summary?.emergency)} level={summary?.emergency ? 'warn' : undefined} />
        <Metric label="미수신" value={num(summary?.stale)} level={summary?.stale ? 'warn' : undefined} />
      </div>
    </Panel>
  );
}

type Level = 'warn' | 'crit' | undefined;

function level(value: number, warnAt: number, critAt: number): Level {
  if (value >= critAt) return 'crit';
  if (value >= warnAt) return 'warn';
  return undefined;
}

function Metric({
  label,
  value,
  unit,
  level,
}: {
  label: string;
  value: string;
  unit?: string;
  level?: Level;
}) {
  return (
    <div className={`metric${level ? ` metric--${level}` : ''}`}>
      <span className="metric__label">{label}</span>
      <span className="metric__value mono">
        {value}
        {unit ? <span className="metric__unit">{unit}</span> : null}
      </span>
    </div>
  );
}
