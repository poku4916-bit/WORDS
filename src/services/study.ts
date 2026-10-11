import type { Rating, StudyMode, StudySession } from '../types';
import { db, DEFAULT_NOTEBOOK_ID, initialProgress, newId } from '../storage/database';
import { notebookService } from './notebooks';
import { buildQueue } from '../study/queue';
import { scheduleReview, studyDate } from '../study/scheduler';

interface SessionOptions { practice?: boolean; reverse?: boolean; timeZone?: string }
interface ReviewOptions { correct?: boolean; timeZone?: string; expectedCursor?: number }

function checkedTimeZone(value = 'Asia/Shanghai') {
  try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); } catch { throw new Error('学习时区无效。'); }
  return value;
}

export const studyService = {
  async startSession(notebookIds: string[], mode: StudyMode, limit = 20, options: SessionOptions = {}): Promise<StudySession> {
    if (!['flashcard', 'spelling'].includes(mode)) throw new Error('学习模式无效。');
    checkedTimeZone(options.timeZone);
    if (!Number.isFinite(limit)) throw new Error('学习数量无效。');
    const snapshot = await notebookService.getSnapshot();
    const ids = [...new Set(notebookIds.length ? notebookIds : [DEFAULT_NOTEBOOK_ID])];
    if (ids.some(id => !snapshot.notebooks.some(n => n.id === id))) throw new Error('所选词本已不存在。');
    const now = Date.now();
    let queue = buildQueue(snapshot, ids, mode, Math.max(1, Math.min(20, Math.floor(limit))), !!options.practice, now);
    if (!queue.length) throw new Error(mode === 'spelling' ? '当前没有适合拼写练习的单词。需要可靠的中英文释义，且单词不能已暂停。' : '当前没有可学习的单词，可添加新词或选择自由练习。');
    return db.transaction('rw', [db.sessions, db.personalWords, db.notebooks], async () => {
      for (const id of ids) if (!await db.notebooks.get(id)) throw new Error('所选词本已不存在。');
      const latest = await db.personalWords.bulkGet(queue);
      queue = queue.filter((_, index) => latest[index] && !latest[index]!.paused);
      if (!queue.length) throw new Error('所选单词已删除或暂停，请重新选择学习范围。');
      if ((await db.sessions.toArray()).some(s => s.finishedAt === undefined)) throw new Error('另一个页面已开始本轮，请继续或结束已有学习。');
      const session: StudySession = { id: newId('session'), notebookIds: ids, mode, practice: !!options.practice, reverse: !!options.reverse, queue, cursor: 0, retryQueue: [], submittedEventIds: [], startedAt: now };
      await db.sessions.add(session);
      return session;
    });
  },

  async submitReview(sessionId: string, wordId: string, rating: Rating, options: ReviewOptions = {}): Promise<StudySession> {
    const timeZone = checkedTimeZone(options.timeZone);
    if (!['forgot', 'fuzzy', 'remembered'].includes(rating)) throw new Error('评分无效。');
    return db.transaction('rw', [db.sessions, db.personalWords, db.words, db.progress, db.reviews], async () => {
      const session = await db.sessions.get(sessionId);
      if (!session) throw new Error('本轮学习记录已不存在。');
      if (session.finishedAt !== undefined || (options.expectedCursor !== undefined && options.expectedCursor !== session.cursor)) return session;
      const currentId = [...session.queue, ...session.retryQueue][session.cursor];
      if (currentId !== wordId) return session; // A stale click from another tab must not advance this card.
      const personal = await db.personalWords.get(wordId), word = await db.words.get(wordId);
      if (!personal || personal.paused || !word) throw new Error('该词已删除或暂停，请刷新本轮学习。');
      const retry = session.cursor >= session.queue.length;
      const planned = !session.practice && !retry;
      const eventId = `${session.id}:${wordId}:${retry ? 'retry' : planned ? 'planned' : 'practice'}`;
      if (await db.reviews.get(eventId)) return session;
      const now = Date.now();
      // Reading within this write transaction always uses the latest version, even across tabs.
      const before = await db.progress.get(wordId) ?? initialProgress(wordId, now);
      const effectiveRating = session.mode === 'spelling' && options.correct !== undefined ? options.correct ? 'remembered' : 'forgot' : rating;
      const after = planned ? scheduleReview(before, effectiveRating, now, timeZone) : { ...before };
      await db.reviews.add({ id: eventId, sessionId, wordId, wordSnapshot: word.word, mode: session.mode, rating: effectiveRating, ...(options.correct === undefined ? {} : { correct: options.correct }), reviewedAt: now, studyDate: studyDate(now, timeZone), timeZone, before, after, planned });
      if (planned) await db.progress.put(after);
      session.submittedEventIds.push(eventId);
      if (!retry && effectiveRating === 'forgot' && !session.retryQueue.includes(wordId)) session.retryQueue.push(wordId);
      session.cursor++;
      if (session.cursor >= session.queue.length + session.retryQueue.length) session.finishedAt = now;
      await db.sessions.put(session);
      return session;
    });
  },

  async resumeSession(): Promise<StudySession | undefined> {
    return (await notebookService.getSnapshot()).session;
  },

  async finishSession(sessionId: string): Promise<void> {
    await db.transaction('rw', db.sessions, async () => {
      const session = await db.sessions.get(sessionId);
      if (session && session.finishedAt === undefined) await db.sessions.update(sessionId, { finishedAt: Date.now() });
    });
  },
};
