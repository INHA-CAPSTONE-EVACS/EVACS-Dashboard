import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
it('Pretendard를 번들에 포함하고 작은 보조 글자도 13px 이상으로 표시한다', () => {
  const css = readFileSync('src/styles.css', 'utf8');
  expect(readFileSync('src/main.tsx', 'utf8')).toContain('pretendard/dist/web/variable/pretendardvariable.css');
  expect(css).toContain("'Pretendard Variable'");
  for (const match of css.matchAll(/font-size:\s*(\d+)px/g)) expect(Number(match[1])).toBeGreaterThanOrEqual(13);
});
