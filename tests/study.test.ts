import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, initialProgress } from '../src/storage/database';
import { notebookService } from '../src/services/notebooks';
import { studyService } from '../src/services/study';
import { addCalendarDays, scheduleReview, studyDate } from '../src/study/scheduler';
import { isSpellingEligible } from '../src/study/queue';
import type { WordEntry } from '../src/types';

const NOW = Date.parse('2026-03-07T17:00:00Z');
const word = (name: string): WordEntry => ({ id: `en:${name}`, word: name, normalizedWord: name, phonetics: [], chineseGlosses: [{ text: '可靠的中文释义', source: 'ECDICT' }], englishSenses: [{ id: `wn:${name}`, pos: 'n', definition: 'a useful English definition', synonyms: [], examples: [], source: 'WordNet' }], sources: ['ECDICT', 'WordNet'], dataVersion: 'test-1', contentStatus: { chinese: true, english: true } });

beforeEach(async () => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); await db.delete(); await db.open(); await notebookService.initialize(); });
afterEach(() => { db.close(); vi.useRealTimers(); });

describe('local-calendar scheduler', () => {
  it('implements all interval steps and clamps the top stage', () => {
    let progress = initialProgress('en:bank', NOW);
    for (const days of [1, 3, 7, 14, 30, 30]) {
      progress = scheduleReview(progress, 'remembered', NOW, 'Asia/Shanghai');
      expect(progress.dueAt).toBe(NOW + days * 86400000);
    }
    expect(progress).toMatchObject({ stage: 4, status: 'familiar', reviewCount: 6 });
  });

  it('keeps a fuzzy new word at stage -1 due tomorrow and forgotten words due in 10 minutes', () => {
    const initial = initialProgress('en:bank', NOW);
    expect(scheduleReview(initial, 'fuzzy', NOW, 'Asia/Shanghai')).toMatchObject({ stage: -1, status: 'learning', dueAt: NOW + 86400000 });
    expect(scheduleReview({ ...initial, stage: 3 }, 'forgot', NOW)).toMatchObject({ stage: -1, status: 'learning', dueAt: NOW + 600000, lapseCount: 1 });
  });

  it('preserves wall-clock time across DST and derives Shanghai dates across UTC midnight', () => {
    expect(addCalendarDays(NOW, 1, 'America/New_York')).toBe(Date.parse('2026-03-08T16:00:00Z'));
    const autumn = Date.parse('2026-10-31T16:00:00Z');
    expect(addCalendarDays(autumn, 1, 'America/New_York')).toBe(Date.parse('2026-11-01T17:00:00Z'));
    expect(studyDate(Date.parse('2026-10-11T16:05:00Z'), 'Asia/Shanghai')).toBe('2026-10-12');
  });
});

describe('persistent sessions and review event consistency', () => {
  it('allows only one active round when two tabs simultaneously start a session', async () => {
    await notebookService.recordSuccessfulSearch(word('bank'), 'bank');
    const results = await Promise.allSettled([
      studyService.startSession(['all'], 'flashcard', 1),
      studyService.startSession(['all'], 'flashcard', 1),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(result => result.status === 'rejected');
    expect(rejected?.status === 'rejected' && rejected.reason.message).toContain('继续或结束已有学习');
    expect((await db.sessions.toArray()).filter(session => session.finishedAt === undefined)).toHaveLength(1);
  });

  it('reviews against the current progress version after another writer changes it', async () => {
    await notebookService.recordSuccessfulSearch(word('bank'), 'bank');
    const session = await studyService.startSession(['all'], 'flashcard', 1);
    const latest = { ...initialProgress('en:bank', NOW), stage: 2, status: 'learning' as const, dueAt: NOW, lastReviewedAt: NOW - 1000, reviewCount: 7, version: 7 };
    await db.progress.put(latest);
    await studyService.submitReview(session.id, 'en:bank', 'remembered', { expectedCursor: 0 });
    expect(await db.progress.get('en:bank')).toMatchObject({ stage: 3, status: 'familiar', reviewCount: 8, version: 8 });
    expect((await db.reviews.toArray())[0].before).toEqual(latest);
  });

  it('prioritizes due words, deduplicates notebooks, excludes paused words and caps new words at ten', async () => {
    for (let i = 0; i < 14; i++) await notebookService.recordSuccessfulSearch(word(`word${i}`), `search${i}`);
    const notebook = await notebookService.create('Reading');
    await notebookService.setMembership('en:word0', [notebook.id]);
    await db.progress.put({ ...initialProgress('en:word0', NOW), status: 'learning', dueAt: NOW - 1, lastReviewedAt: NOW - 1000 });
    await notebookService.pause('en:word1', true);
    const session = await studyService.startSession(['all', notebook.id], 'flashcard', 20);
    expect(session.queue[0]).toBe('en:word0');
    expect(session.queue).toHaveLength(11);
    expect(new Set(session.queue).size).toBe(11);
    expect(session.queue).not.toContain('en:word1');
  });

  it('submits concurrent double-clicks once and resumes its persisted cursor after reopen', async () => {
    await notebookService.recordSuccessfulSearch(word('bank'), 'bank');
    await notebookService.recordSuccessfulSearch(word('light'), 'light');
    const session = await studyService.startSession(['all'], 'flashcard', 20);
    await Promise.all([studyService.submitReview(session.id, 'en:bank', 'remembered', { expectedCursor: 0 }), studyService.submitReview(session.id, 'en:bank', 'remembered', { expectedCursor: 0 })]);
    expect((await db.progress.get('en:bank'))?.reviewCount).toBe(1);
    expect(await db.reviews.count()).toBe(1);
    db.close(); await db.open();
    expect(await studyService.resumeSession()).toMatchObject({ id: session.id, cursor: 1 });
  });

  it('queues one forgotten-word retry and records its practice without rescheduling', async () => {
    await notebookService.recordSuccessfulSearch(word('bank'), 'bank');
    const session = await studyService.startSession(['all'], 'spelling', 1);
    const first = await studyService.submitReview(session.id, 'en:bank', 'remembered', { correct: false, expectedCursor: 0 });
    expect(first.retryQueue).toEqual(['en:bank']);
    const scheduled = await db.progress.get('en:bank');
    await studyService.submitReview(session.id, 'en:bank', 'remembered', { correct: false, expectedCursor: 0 });
    expect(await db.reviews.count()).toBe(1);
    const finished = await studyService.submitReview(session.id, 'en:bank', 'remembered', { correct: true, expectedCursor: 1 });
    expect(finished.finishedAt).toBe(NOW);
    expect(await db.progress.get('en:bank')).toEqual(scheduled);
    expect((await db.reviews.toArray()).filter(e => e.planned)).toHaveLength(1);
    expect(await studyService.resumeSession()).toBeUndefined();
  });

  it('free practice logs reviews but changes neither stage nor due date', async () => {
    await notebookService.recordSuccessfulSearch(word('bank'), 'bank');
    const initial = await db.progress.get('en:bank');
    const session = await studyService.startSession(['all'], 'flashcard', 1, { practice: true });
    await studyService.submitReview(session.id, 'en:bank', 'remembered');
    expect(await db.progress.get('en:bank')).toEqual(initial);
    expect((await db.reviews.toArray())[0].planned).toBe(false);
  });

  it('rejects missing bilingual content and name transliterations for spelling', () => {
    expect(isSpellingEligible(word('bank'))).toBe(true);
    expect(isSpellingEligible({ ...word('bank'), chineseGlosses: [] })).toBe(false);
    expect(isSpellingEligible({ ...word('bank'), englishSenses: [] })).toBe(false);
    expect(isSpellingEligible({ ...word('abigail'), chineseGlosses: [{ text: '阿比盖尔（女子名）', source: 'ECDICT' }] })).toBe(false);
  });
});
