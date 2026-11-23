/** 패널 공통 껍데기. 제목줄 + 조회 상태 표시 + 본문. */
import type { ReactNode } from 'react';

interface Props {
  title: string;
  /** 제목 오른쪽 보조 정보 (건수 등) */
  meta?: ReactNode;
  /** 조회 실패 사유. 있으면 마지막 정상 데이터를 유지한 채 경고만 띄운다. */
  error?: string | null;
  /** 요청이 떠 있는 동안 제목줄에 가는 막대 */
  busy?: boolean;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function Panel({ title, meta, error, busy, actions, children, className }: Props) {
  return (
    <section className={`panel${className ? ` ${className}` : ''}`}>
      <header className="panel__head">
        <h2 className="panel__title">{title}</h2>
        {meta ? <span className="panel__meta mono">{meta}</span> : null}
        {actions ? <div className="panel__actions">{actions}</div> : null}
        <span className={`panel__pulse${busy ? ' is-busy' : ''}`} aria-hidden />
      </header>
      {error ? (
        <div className="panel__error" role="status">
          갱신 지연 · {error}
        </div>
      ) : null}
      <div className="panel__body">{children}</div>
    </section>
  );
}
