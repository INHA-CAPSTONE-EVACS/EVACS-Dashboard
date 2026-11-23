/**
 * 관제 API 호출 지연·처리량 수집기 (KpiPanel 데이터 출처).
 *
 * 확정 필요: 설계서 KpiPanel의 "알림 지연(p99)"은 본래 서버가 측정한 end-to-end
 * 알림 지연이어야 하지만, 관제서버에 KPI 엔드포인트가 아직 없다.
 * 지금은 대시보드가 관측한 API 응답 지연으로 대신 채운다.
 * 서버에 /control/kpi가 생기면 이 모듈 대신 그쪽을 읽도록 KpiPanel만 바꾸면 된다.
 */

export interface KpiSnapshot {
  /** 최근 윈도우 응답 지연 p50 (ms) */
  p50: number;
  /** 최근 윈도우 응답 지연 p99 (ms) */
  p99: number;
  /** 최근 윈도우 초당 요청 수 */
  throughput: number;
  /** 최근 윈도우 실패율 (0~1) */
  errorRate: number;
  /** 윈도우에 들어온 표본 수 */
  samples: number;
}

interface Sample {
  at: number;
  elapsed: number;
  ok: boolean;
}

/** 이 길이만큼의 최근 호출만 본다. 관제 화면은 "지금"의 상태를 봐야 한다. */
const WINDOW_MS = 30_000;
const MAX_SAMPLES = 2000;

const EMPTY: KpiSnapshot = { p50: 0, p99: 0, throughput: 0, errorRate: 0, samples: 0 };

class ApiMetrics {
  private samples: Sample[] = [];
  private listeners = new Set<() => void>();
  private cache: KpiSnapshot = EMPTY;
  private cacheAt = 0;

  record(_label: string, elapsed: number, ok: boolean): void {
    const now = Date.now();
    this.samples.push({ at: now, elapsed, ok });
    if (this.samples.length > MAX_SAMPLES) {
      this.samples.splice(0, this.samples.length - MAX_SAMPLES);
    }
    this.cacheAt = 0;
    for (const l of this.listeners) l();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * useSyncExternalStore가 매 렌더 호출하므로 같은 tick 안에서는 같은 객체를 돌려준다.
   * 매번 새 객체를 만들면 무한 렌더가 난다.
   */
  getSnapshot = (): KpiSnapshot => {
    const now = Date.now();
    if (this.cacheAt && now - this.cacheAt < 200) return this.cache;

    const cutoff = now - WINDOW_MS;
    const live = this.samples.filter((s) => s.at >= cutoff);
    if (live.length === 0) {
      this.cache = EMPTY;
      this.cacheAt = now;
      return this.cache;
    }

    const sorted = live.map((s) => s.elapsed).sort((a, b) => a - b);
    const failed = live.reduce((n, s) => n + (s.ok ? 0 : 1), 0);
    this.cache = {
      p50: percentile(sorted, 0.5),
      p99: percentile(sorted, 0.99),
      throughput: live.length / (WINDOW_MS / 1000),
      errorRate: failed / live.length,
      samples: live.length,
    };
    this.cacheAt = now;
    return this.cache;
  };
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, idx)]);
}

export const apiMetrics = new ApiMetrics();
