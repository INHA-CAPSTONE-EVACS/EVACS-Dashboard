/**
 * 주기 조회 공통 로직 (설계서 "조회 실패·지연 처리").
 *
 * 규칙 두 가지만 지킨다:
 *  1. 이전 요청이 끝나기 전에는 다음 요청을 겹쳐 보내지 않는다.
 *  2. 조회가 실패하거나 지연되어도 마지막 정상 데이터를 유지하고 상태만 바꾼다.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export interface PollingResult<T> {
  /** 마지막으로 성공한 데이터. 실패해도 지워지지 않는다. */
  data: T | null;
  /** 첫 조회를 아직 못 받은 상태 */
  loading: boolean;
  /** 직전 조회가 실패했을 때의 사유. 성공하면 null로 돌아간다. */
  error: string | null;
  /** data를 받은 시각 */
  updatedAt: number | null;
  /** 지금 요청이 떠 있는지 */
  inFlight: boolean;
  /** 주기와 무관하게 즉시 한 번 조회 */
  refresh: () => void;
}

export function usePolling<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  intervalMs: number,
  deps: unknown[],
  enabled = true,
): PollingResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [inFlight, setInFlight] = useState(false);
  const [loading, setLoading] = useState(true);

  // 최신 fetcher를 ref로 들고 간다. deps가 아니라 이 ref로 호출해야
  // 매 렌더마다 새로 만들어지는 화살표 함수가 타이머를 재시작시키지 않는다.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const busyRef = useRef(false);
  const tickRef = useRef<(() => void) | null>(null);

  const run = useCallback(async () => {
    if (busyRef.current) return; // 규칙 1: 겹쳐 쏘지 않는다
    busyRef.current = true;
    setInFlight(true);
    const controller = new AbortController();
    try {
      const next = await fetcherRef.current(controller.signal);
      setData(next); // 규칙 2: 성공했을 때만 갈아끼운다
      setUpdatedAt(Date.now());
      setError(null);
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      busyRef.current = false;
      setInFlight(false);
      setLoading(false);
    }
  }, []);

  tickRef.current = run;

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void run();
    if (intervalMs <= 0) return;
    const timer = window.setInterval(() => void tickRef.current?.(), intervalMs);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, enabled, ...deps]);

  return { data, loading, error, updatedAt, inFlight, refresh: run };
}
