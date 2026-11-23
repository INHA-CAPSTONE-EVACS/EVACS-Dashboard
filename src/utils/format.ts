/** 관제 화면 표기 공통. 시각은 전부 KST, 숫자는 자리수 고정. */

const TIME = new Intl.DateTimeFormat('ko-KR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'Asia/Seoul',
});

const DATETIME = new Intl.DateTimeFormat('ko-KR', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: 'Asia/Seoul',
});

export function hhmmss(value: string | number | null | undefined): string {
  if (value == null) return '--:--:--';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '--:--:--' : TIME.format(d);
}

export function stamp(value: string | number | null | undefined): string {
  if (value == null) return '-';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '-' : DATETIME.format(d);
}

/** 경과 시간. 관제사는 "언제"보다 "얼마나 됐나"를 먼저 본다. */
export function elapsed(from: string | number | null | undefined, to = Date.now()): string {
  if (from == null) return '-';
  const start = new Date(from).getTime();
  if (Number.isNaN(start)) return '-';
  const sec = Math.max(0, Math.floor((to - start) / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${pad(m)}:${pad(s)}`;
  return `${pad(m)}:${pad(s)}`;
}

export function pad(n: number): string {
  return String(n).padStart(2, '0');
}

export function num(n: number | null | undefined, digits = 0): string {
  if (n == null || Number.isNaN(n)) return '-';
  return n.toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** 긴급상황 유형 코드 → 화면 표기. 서버가 자유 문자열을 받으므로 모르는 값은 그대로 보여준다. */
const EMERGENCY_TYPE_LABEL: Record<string, string> = {
  FIRE: '화재',
  AMBULANCE: '구급',
  RESCUE: '구조',
  POLICE: '경찰',
  DISASTER: '재난',
};

export function emergencyTypeLabel(type: string): string {
  return EMERGENCY_TYPE_LABEL[type?.toUpperCase()] ?? type;
}

export const EMERGENCY_TYPES = Object.keys(EMERGENCY_TYPE_LABEL);
