import type { Rating, StudyProgress } from '../types';

export const INTERVAL_DAYS = [1, 3, 7, 14, 30] as const;

function localParts(time: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(time);
  const read = (key: string) => Number(parts.find(p => p.type === key)?.value);
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute'), second: read('second') };
}

export function studyDate(time: number, timeZone: string): string {
  const p = localParts(time, timeZone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Add local calendar days, preserving the wall clock across daylight-saving changes. */
export function addCalendarDays(time: number, days: number, timeZone: string): number {
  const p = localParts(time, timeZone);
  const target = Date.UTC(p.year, p.month - 1, p.day + days, p.hour, p.minute, p.second, time % 1000);
  let result = target;
  const seen = new Set<number>();
  for (let i = 0; i < 8; i++) {
    const q = localParts(result, timeZone);
    const local = Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute, q.second, result % 1000);
    const next = result + target - local;
    if (next === result) return result;
    // A skipped wall time (e.g. 02:30 at spring-forward) moves to the next valid time.
    if (seen.has(next)) return Math.max(result, next);
    seen.add(result);
    result = next;
  }
  return result;
}

export function scheduleReview(before: StudyProgress, rating: Rating, now: number, timeZone = 'Asia/Shanghai'): StudyProgress {
  if (!['forgot', 'fuzzy', 'remembered'].includes(rating)) throw new Error('评分无效。');
  const stage = rating === 'forgot' ? -1 : rating === 'fuzzy' ? Math.max(-1, before.stage - 1) : Math.min(4, before.stage + 1);
  const dueAt = rating === 'forgot' ? now + 10 * 60 * 1000 : addCalendarDays(now, rating === 'fuzzy' ? 1 : INTERVAL_DAYS[stage], timeZone);
  return { ...before, stage, status: rating === 'remembered' && stage >= 3 ? 'familiar' : 'learning', dueAt, lastReviewedAt: now, reviewCount: before.reviewCount + 1, lapseCount: before.lapseCount + (rating === 'forgot' ? 1 : 0), schedulerVersion: 1, updatedAt: now, version: before.version + 1 };
}
