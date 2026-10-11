import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, Clock3, Keyboard, RotateCcw, Sparkles } from 'lucide-react';
import type { Preferences, Rating, Snapshot, StudyMode, StudySession, WordEntry } from '../types';
import { studyService } from '../services/study';
import { isSpellingEligible } from '../study/queue';
import { normalizeKey } from '../dictionary/core.mjs';
import { errorMessage } from '../utils';
import WordContent from '../components/WordContent';
import '../styles/study.css';

type Props = { snapshot: Snapshot; refresh: () => Promise<void>; notify: (message: string) => void; preferences: Preferences };
type SpellingFeedback = { correct: boolean; answer: string; nextSession: StudySession };
const ratings: { value: Rating; label: string; key: string; detail: string }[] = [
  { value: 'forgot', label: '忘记', key: '1', detail: '再见一次' },
  { value: 'fuzzy', label: '模糊', key: '2', detail: '还需巩固' },
  { value: 'remembered', label: '记住', key: '3', detail: '继续向前' },
];
const normalizeAnswer = (value: string) => normalizeKey(value).replace(/\s+/g, ' ');
const maskAnswer = (value: string, word: WordEntry) => value.replace(new RegExp(word.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '____');
const absoluteDate = (value: number, timeZone: string) => new Intl.DateTimeFormat('zh-CN', { timeZone, year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(value);

export default function StudyPage({ snapshot, refresh, notify, preferences }: Props) {
  const defaultNotebook = snapshot.notebooks.find(n => n.isDefault)?.id || 'all';
  const [notebookIds, setNotebookIds] = useState<string[]>([defaultNotebook]);
  const [mode, setMode] = useState<StudyMode>('flashcard');
  const [practice, setPractice] = useState(false);
  const [reverse, setReverse] = useState(false);
  const [limit, setLimit] = useState(Math.max(1, Math.min(20, preferences.studyLimit)));
  const [session, setSession] = useState<StudySession>();
  const [summary, setSummary] = useState<StudySession>();
  const [revealed, setRevealed] = useState(false);
  const [answer, setAnswer] = useState('');
  const [feedback, setFeedback] = useState<SpellingFeedback>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState(false);
  const [shortcuts, setShortcuts] = useState(preferences.shortcuts);
  const operation = useRef(false);
  const composing = useRef(false);
  const taskRegion = useRef<HTMLDivElement>(null);
  const spellingInput = useRef<HTMLInputElement>(null);
  const currentId = session ? [...session.queue, ...session.retryQueue][session.cursor] : undefined;
  const currentWord = snapshot.personalWords.some(w => w.wordId === currentId && !w.paused) ? snapshot.words.find(w => w.id === currentId) : undefined;
  const currentNote = snapshot.personalWords.find(w => w.wordId === currentId)?.note;
  const retry = !!session && session.cursor >= session.queue.length;

  useEffect(() => setShortcuts(preferences.shortcuts), [preferences.shortcuts]);
  useEffect(() => setLimit(Math.max(1, Math.min(20, preferences.studyLimit))), [preferences.studyLimit]);
  useEffect(() => {
    setRevealed(false); setAnswer(''); setFeedback(undefined); composing.current = false;
    if (session) {
      if (session.mode === 'spelling') spellingInput.current?.focus();
      else taskRegion.current?.focus();
    }
  }, [session?.id, session?.cursor]);
  useEffect(() => {
    if (busy) return;
    if (feedback) taskRegion.current?.querySelector<HTMLButtonElement>('[data-study-next]')?.focus();
    else if (revealed && session?.mode === 'flashcard') taskRegion.current?.focus();
  }, [revealed, feedback, session?.mode, busy]);
  useEffect(() => {
    const saved = snapshot.session;
    if (!session || !saved || saved.id !== session.id || saved.cursor < session.cursor || feedback || busy) return;
    if (saved.cursor > session.cursor || saved.queue.join('|') !== session.queue.join('|') || saved.retryQueue.join('|') !== session.retryQueue.join('|')) {
      setRevealed(false); setAnswer(''); setSession(saved);
    }
  }, [snapshot.session, session, feedback, busy]);

  const selection = useMemo(() => {
    const all = notebookIds.includes(defaultNotebook);
    const ids = new Set(all ? snapshot.personalWords.map(p => p.wordId) : snapshot.memberships.filter(m => notebookIds.includes(m.notebookId)).map(m => m.wordId));
    const words = snapshot.words.filter(w => ids.has(w.id) && snapshot.personalWords.some(p => p.wordId === w.id && !p.paused));
    return words.filter(w => mode === 'flashcard' || isSpellingEligible(w));
  }, [snapshot, notebookIds, defaultNotebook, mode]);
  const now = Date.now();
  const dueWords = selection.filter(w => { const p = snapshot.progress.find(p => p.wordId === w.id); return p?.dueAt != null && p.dueAt <= now; });
  const newWords = selection.filter(w => { const p = snapshot.progress.find(p => p.wordId === w.id); return !p || p.status === 'new'; });
  const futureDates = selection.map(w => snapshot.progress.find(p => p.wordId === w.id)?.dueAt).filter((date): date is number => date != null && date > now);
  const nextDue = futureDates.length ? Math.min(...futureDates) : undefined;
  const availableCount = practice ? selection.length : dueWords.length + Math.min(10, newWords.length);
  const sessionReviews = summary ? snapshot.reviews.filter(r => r.sessionId === summary.id).sort((a, b) => a.reviewedAt - b.reviewedAt || a.id.localeCompare(b.id)) : [];
  const firstReviewMap = new Map<string, (typeof sessionReviews)[number]>();
  for (const review of sessionReviews) if (!firstReviewMap.has(review.wordId)) firstReviewMap.set(review.wordId, review);
  const firstReviews = [...firstReviewMap.values()];
  const correctCount = firstReviews.filter(r => r.correct === true).length;
  const plannedDates = firstReviews.filter(r => r.planned && r.after.dueAt != null).map(r => r.after.dueAt!);
  const summaryNext = plannedDates.length ? Math.min(...plannedDates) : nextDue;

  const perform = async (action: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true; setBusy(true); setError('');
    try { await action(); }
    catch (e) { setError(errorMessage(e)); }
    finally { operation.current = false; setBusy(false); }
  };
  const synchronize = async () => {
    try { await refresh(); setReadError(false); }
    catch (e) { setReadError(true); throw new Error(`本轮进度已保存，但页面数据暂时未能读取。${errorMessage(e)}`); }
  };
  const adoptSession = (next: StudySession) => {
    setRevealed(false); setAnswer(''); setFeedback(undefined);
    if (next.finishedAt || next.cursor >= next.queue.length + next.retryQueue.length) { setSummary(next); setSession(undefined); }
    else { setSession(next); setSummary(undefined); }
  };
  const start = () => perform(async () => {
    if (!notebookIds.length) throw new Error('请至少选择一个词本。');
    const next = await studyService.startSession(notebookIds, mode, limit, { practice, reverse: mode === 'flashcard' && reverse, timeZone: preferences.timeZone });
    adoptSession(next); await synchronize();
  });
  const resume = () => perform(async () => {
    const next = await studyService.resumeSession();
    if (next) adoptSession(next);
    else { setSession(undefined); notify('这一轮已结束，请开始新一轮。'); }
    await synchronize();
  });
  const finish = (target: StudySession) => perform(async () => {
    await studyService.finishSession(target.id);
    setSummary({ ...target, finishedAt: Date.now() }); setSession(undefined); setFeedback(undefined);
    await synchronize();
  });
  const score = (rating: Rating) => perform(async () => {
    if (!session || !currentId || !revealed) return;
    const next = await studyService.submitReview(session.id, currentId, rating, { timeZone: preferences.timeZone, expectedCursor: session.cursor });
    adoptSession(next); await synchronize();
  });
  const submitSpelling = () => perform(async () => {
    if (!session || !currentWord || feedback || !answer.trim() || composing.current) return;
    const correct = normalizeAnswer(answer) === normalizeAnswer(currentWord.normalizedWord);
    const next = await studyService.submitReview(session.id, currentWord.id, correct ? 'remembered' : 'forgot', { correct, timeZone: preferences.timeZone, expectedCursor: session.cursor });
    setFeedback({ correct, answer: answer.trim(), nextSession: next }); setRevealed(true);
    await synchronize();
  });
  const onTaskKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!shortcuts || busy || !session || session.mode !== 'flashcard' || event.repeat || event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], dialog')) return;
    if (event.code === 'Space' && !revealed && !target.closest('button')) { event.preventDefault(); setRevealed(true); }
    const rating = ratings.find(r => r.key === event.key);
    if (revealed && rating) { event.preventDefault(); void score(rating.value); }
  };
  const notice = error && <div className="notice notice-error study-error" role="alert"><p>{error}</p>{readError ? <button className="button" disabled={busy} onClick={() => void perform(synchronize)}>重试读取数据</button> : session && <button className="button" disabled={busy} onClick={() => void resume()}>重新读取本轮</button>}</div>;

  if (summary) return <div className="study-page study-summary page-enter">
    <div className="study-completion-mark" aria-hidden="true"><CheckCircle2 size={34} strokeWidth={1.3} /></div>
    <span className="eyebrow">A LITTLE MORE, EVERY DAY</span>
    <h1>这一轮，留在记忆里。</h1>
    <p className="muted">{summary.practice ? '自由练习已记录，计划复习日期保持原样。' : '每一次回忆，都让熟悉多一点。'}</p>
    {notice}
    {readError ? <p className="muted">重新读取数据后，将展示本轮的完整统计。</p> : <><div className="study-summary-main"><strong className="serif">{firstReviews.length.toString().padStart(2, '0')}</strong><span>个不同单词已完成</span></div>
    {summary.mode === 'flashcard' ? <div className="study-distribution" aria-label="本轮首次自评分布">{ratings.map(r => <div key={r.value}><span>{r.label}</span><strong>{firstReviews.filter(e => e.rating === r.value).length}</strong></div>)}</div> : <div className="study-spelling-result"><strong className="serif">{firstReviews.length ? Math.round(correctCount / firstReviews.length * 100) : 0}<span>%</span></strong><p>首次提交正确率 · {correctCount} / {firstReviews.length} 个词</p></div>}
    <div className="study-next-date"><Clock3 size={18} /><p>{summaryNext ? <>下一次复习：<strong>{absoluteDate(summaryNext, preferences.timeZone)}</strong></> : '目前没有已安排的复习。'}<span>{preferences.timeZone}{sessionReviews.length > firstReviews.length ? ` · 含重练共 ${sessionReviews.length} 次练习` : ''}</span></p></div></>}
    <div className="study-summary-actions"><button className="button button-primary" disabled={busy} onClick={() => { setSummary(undefined); setError(''); }}>再学一轮<ArrowRight size={18} /></button><a className="button button-ghost" href="#/notebooks">回到词本</a></div>
  </div>;

  if (session) {
    const total = session.queue.length + session.retryQueue.length;
    const progress = Math.min(total, feedback?.nextSession.cursor ?? session.cursor);
    return <div className="study-page study-focus page-enter" ref={taskRegion} tabIndex={0} onKeyDown={onTaskKey} aria-label="学习任务区域" aria-busy={busy}>
      <header className="study-session-header"><button className="button button-ghost study-back" disabled={busy} onClick={() => { setSession(undefined); setFeedback(undefined); setError(''); notify('本轮进度已保存，可以稍后继续。'); }}><ArrowLeft size={18} />返回</button><div className="study-session-progress"><span>{session.mode === 'flashcard' ? '翻卡回忆' : '拼写练习'}<span className="muted"> · {session.practice ? '自由练习' : '今日复习'}</span></span><strong>{Math.min(total, session.cursor + 1)}<span> / {total}</span></strong></div><button className="button button-ghost study-finish" disabled={busy} onClick={() => void finish(feedback?.nextSession || session)}>结束本轮</button></header>
      <div className="study-progress-track" role="progressbar" aria-label="本轮已提交进度" aria-valuemin={0} aria-valuemax={total} aria-valuenow={progress}><span style={{ width: `${total ? progress / total * 100 : 0}%` }} /></div>
      {notice}
      {currentWord ? <>
        <article className="study-card" key={`${session.id}-${session.cursor}`}><div className="study-card-topline"><span className="eyebrow">{retry ? 'ONCE MORE / 重练' : 'TAKE A MOMENT / 回忆片刻'}</span><span className="study-card-number">{String(Math.min(session.queue.length, session.cursor + 1)).padStart(2, '0')}</span></div>
          {session.mode === 'flashcard' && !session.reverse ? <div className="study-question study-question-word"><h1 className="serif" lang="en">{currentWord.word}</h1><p className="study-phonetics" lang="en">{currentWord.phonetics.map(p => `/${p.replace(/^\/+|\/+$/g, '')}/`).join(' · ') || '暂无音标'}</p></div> : <div className="study-question study-question-gloss"><span className="study-prompt-label">{session.mode === 'spelling' ? '根据中文释义，写出英文单词' : '根据中文释义，回忆英文单词'}</span>{currentWord.chineseGlosses.length ? currentWord.chineseGlosses.map((g, i) => <p key={i}>{maskAnswer(g.text, currentWord)}</p>) : <p className="muted">该词暂无中文释义，可查看答案学习已有内容。</p>}{session.mode === 'spelling' && !revealed && currentWord.englishSenses.length > 0 && <details className="study-hint"><summary>看看英文提示</summary><p lang="en">{maskAnswer(currentWord.englishSenses[0].definition, currentWord)}</p></details>}</div>}
          {session.mode === 'spelling' && !feedback && <form className="study-spelling-form" onSubmit={e => { e.preventDefault(); if (!composing.current) void submitSpelling(); }}><label htmlFor="spelling-answer">你的拼写</label><div className="study-spelling-input"><input id="spelling-answer" ref={spellingInput} value={answer} onChange={e => setAnswer(e.target.value)} disabled={busy} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={e => { if (e.key === 'Enter' && (e.nativeEvent.isComposing || composing.current)) e.preventDefault(); }} type="text" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={80} placeholder="写下你回忆到的单词…" /><button className="button button-primary" type="submit" disabled={busy || !answer.trim()}>{busy ? '保存中…' : '检查答案'}<ArrowRight size={17} /></button></div></form>}
          {revealed && <section className="study-answer"><div className="study-answer-label" role="status">{feedback ? <><CheckCircle2 size={18} /><span>{feedback.correct ? '拼写正确' : '这次没有拼对，再认识一次。'}</span></> : <><BookOpen size={18} /><span>答案已揭示</span></>}</div>{feedback && <p className="study-your-answer">你的拼写：<span lang="en">{feedback.answer}</span></p>}{(session.reverse || session.mode === 'spelling') && <h2 className="serif study-revealed-word" lang="en">{currentWord.word}</h2>}<WordContent word={currentWord} compact />{currentNote && <section className="study-personal-note"><span className="section-label">个人笔记</span><p>{currentNote}</p></section>}</section>}
        </article>
        <div className="study-actions">{session.mode === 'flashcard' ? !revealed ? <button className="button button-primary study-reveal" disabled={busy} onClick={() => setRevealed(true)}>查看答案{shortcuts && <kbd>Space</kbd>}</button> : <div className="study-rating-buttons">{ratings.map(r => <button key={r.value} className={`button study-rating ${r.value === 'remembered' ? 'button-primary' : ''}`} disabled={busy} onClick={() => void score(r.value)}><span>{r.label}{shortcuts && <kbd>{r.key}</kbd>}</span><small>{r.detail}</small></button>)}</div> : feedback && <button className="button button-primary study-reveal" data-study-next disabled={busy} onClick={() => { setFeedback(undefined); adoptSession(feedback.nextSession); }}>{feedback.nextSession.finishedAt ? '查看本轮结果' : '下一个词'}<ArrowRight size={18} /></button>}</div>
        <div className="study-session-footnote">{(retry || session.practice) && <span>{retry ? '本次重练只记录练习，不重复调整复习计划。' : '自由练习只记录日志，不改变复习计划。'}</span>}{session.mode === 'flashcard' && <label><Keyboard size={15} /><input type="checkbox" checked={shortcuts} onChange={e => setShortcuts(e.target.checked)} />键盘快捷键</label>}</div>
      </> : <div className="empty-state"><BookOpen size={30} /><h2>这张词卡已不在词本中。</h2><p>重新读取本轮，继续剩余单词。</p><button className="button button-primary" disabled={busy} onClick={() => void resume()}>继续本轮</button></div>}
    </div>;
  }

  const saved = snapshot.session;
  return <div className="study-page study-prepare page-enter">
    <header className="page-heading"><div><span className="eyebrow">03 / KEEP IT CLOSE</span><h1>今天，留住几个词。</h1><p className="muted">从回忆开始，让遇见的词成为自己的表达。</p></div><div className="study-heading-mark" aria-hidden="true"><Sparkles size={36} strokeWidth={1} /><span>MAKE IT<br />STAY.</span></div></header>
    {notice}
    {saved && <section className="study-resume notice"><RotateCcw size={23} /><div><strong>上次学到第 {Math.min(saved.cursor + 1, saved.queue.length + saved.retryQueue.length)} 个词。</strong><p>{saved.mode === 'flashcard' ? '翻卡回忆' : '拼写练习'} · {saved.practice ? '自由练习' : '今日复习'} · 已保存 {saved.cursor} 次练习</p></div><div><button className="button button-primary" disabled={busy} onClick={() => void resume()}>继续本轮<ArrowRight size={16} /></button><button className="button button-ghost" disabled={busy} onClick={() => void finish(saved)}>结束本轮</button></div></section>}
    <div className="study-prepare-layout"><section className="study-configuration panel"><div className="study-section-title"><span className="eyebrow">YOUR NEXT SESSION</span><h2>设置本轮</h2></div>
      <fieldset className="study-notebooks"><legend>选择词本</legend><div>{snapshot.notebooks.map(n => <label key={n.id} className={notebookIds.includes(n.id) ? 'is-selected' : ''}><input type="checkbox" checked={notebookIds.includes(n.id)} disabled={busy} onChange={e => setNotebookIds(ids => e.target.checked ? [...ids, n.id] : ids.filter(id => id !== n.id))} /><span>{n.name}</span>{notebookIds.includes(n.id) && <Check size={16} aria-hidden="true" />}</label>)}</div><p className="muted">可同时选择多个词本，相同单词只出现一次。</p></fieldset>
      <fieldset className="study-mode"><legend>学习方式</legend><div className="study-segmented">{([{ id: 'flashcard', title: '翻卡回忆', description: '先想一想，再揭示含义' }, { id: 'spelling', title: '拼写练习', description: '从词义出发，写出单词' }] as const).map(m => <button type="button" key={m.id} className={mode === m.id ? 'is-selected' : ''} aria-pressed={mode === m.id} disabled={busy} onClick={() => setMode(m.id)}><strong>{m.title}</strong><span>{m.description}</span></button>)}</div></fieldset>
      <fieldset className="study-plan"><legend>练习范围</legend><div className="study-plan-options"><label><input type="radio" name="study-plan" checked={!practice} disabled={busy} onChange={() => setPractice(false)} /><span><strong>今日复习</strong><small>到期词优先，再加入最多 10 个新词</small></span></label><label><input type="radio" name="study-plan" checked={practice} disabled={busy} onChange={() => setPractice(true)} /><span><strong>自由练习</strong><small>随时练一练，不调整复习日期</small></span></label></div></fieldset>
      <div className="study-options"><label className="field study-limit">本轮数量<select value={limit} disabled={busy} onChange={e => setLimit(Number(e.target.value))}>{Array.from({ length: 20 }, (_, i) => i + 1).map(n => <option value={n} key={n}>{n} 个词</option>)}</select></label>{mode === 'flashcard' && <label className="study-reverse"><input type="checkbox" checked={reverse} disabled={busy} onChange={e => setReverse(e.target.checked)} /><span>中文提示，回忆英文</span></label>}</div>
      {mode === 'spelling' && <p className="study-eligibility-note muted">拼写题只使用有可靠中英文释义的词，专名与纯音译词会跳过。</p>}
      <button className="button button-primary study-start" disabled={busy || !!saved || !availableCount || !notebookIds.length} onClick={() => void start()}>{busy ? '准备中…' : '开始本轮'}<span>{Math.min(limit, availableCount)} 个词</span><ArrowRight size={18} /></button>{saved && <p className="study-start-note muted">继续或结束已保存的本轮后，即可开始新一轮。</p>}
    </section>
    <aside className="study-overview"><span className="eyebrow">A FEW WORDS FOR TODAY</span><div className="study-overview-count"><strong className="serif">{dueWords.length.toString().padStart(2, '0')}</strong><span>个词待复习</span></div><div className="study-new-count"><span>尚未学习的新词</span><strong>{newWords.length}</strong></div><p className="muted">{availableCount ? `本轮将从所选词本中安排 ${Math.min(limit, availableCount)} 个不同单词。` : selection.length ? '今天的复习已完成。可以选择自由练习，提前再见一次。' : mode === 'spelling' ? '当前词本还没有适合拼写的词。试试翻卡回忆，或先去查词。' : '从一个词开始。查词成功后，单词会自动收录到词本。'}</p>{nextDue && <div className="study-upcoming"><Clock3 size={18} /><span>下次到期<strong>{absoluteDate(nextDue, preferences.timeZone)}</strong></span></div>}{!selection.length && <a className="button button-ghost" href="#/search">去查词<ArrowRight size={16} /></a>}{!availableCount && selection.length > 0 && !practice && <button className="button button-ghost" disabled={busy} onClick={() => setPractice(true)}>自由练习<ArrowRight size={16} /></button>}<div className="study-overview-footer"><BookOpen size={27} strokeWidth={1.2} /><p>不急于一次记住。<br />让每一次重逢，都多留下一点。</p></div></aside></div>
  </div>;
}
