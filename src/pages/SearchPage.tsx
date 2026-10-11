import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, Check, Search, SlidersHorizontal } from 'lucide-react';
import type { Preferences, Snapshot, WordEntry } from '../types';
import { dictionaryService, normalizeQuery } from '../services/dictionary';
import { notebookService } from '../services/notebooks';
import WordContent from '../components/WordContent';
import WordEditor from '../components/WordEditor';
import { dateLabel, errorMessage } from '../utils';
export default function SearchPage({ snapshot, refresh, notify, request, preferences, navigate }: { snapshot: Snapshot; refresh: () => Promise<void>; notify: (message: string) => void; request?: { word: string; id: string; record: boolean }; preferences: Preferences; navigate: (page: string, word?: string) => void }) {
  const [input,setInput] = useState('');
  const [word,setWord] = useState<WordEntry>();
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  const [saveError,setSaveError] = useState('');
  const [saving,setSaving] = useState(false);
  const [receipt,setReceipt] = useState('');
  const [edit,setEdit] = useState(false);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const pending = useRef<{word:WordEntry; id:string} | undefined>(undefined);
  const handled = useRef('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const lookup = async (query: string, record = true) => {
    setInput(query); setError(''); setSaveError(''); setReceipt(''); setEdit(false); pending.current = undefined;
    const seq = ++sequence.current;
    const actionId = crypto.randomUUID();
    setLoading(true);
    try {
      const normalized = normalizeQuery(query);
      const entry = snapshot.words.find(w => w.normalizedWord === normalized) || await dictionaryService.lookup(query);
      if (mounted.current && seq === sequence.current) { setWord(entry); history.replaceState(null, '', `#/search?q=${encodeURIComponent(entry.word)}`); }
      if (!record) { if (mounted.current && seq === sequence.current && snapshot.personalWords.some(w => w.wordId === entry.id)) setReceipt('已收录于我的单词'); return; }
      let saved = false;
      try {
        const result = await notebookService.recordSuccessfulSearch(entry, actionId);
        saved = true;
        if (mounted.current && seq === sequence.current) setReceipt(result.isNew ? '已记录到我的单词' : '已更新查询记录');
      } catch(e) {
        if (mounted.current && seq === sequence.current) { pending.current = {word:entry,id:actionId}; setSaveError(`词条已查到，但本次记录未保存。${errorMessage(e)}`); }
      }
      if (saved) { try { await refresh(); } catch { if(mounted.current && seq === sequence.current) setSaveError('查询记录已保存，但列表读取失败。请重新读取。'); } }
    } catch(e) { if (mounted.current && seq === sequence.current) { setWord(undefined); const code = (e as {code?:string}).code; setError(code === 'NOT_FOUND' ? '没有找到这个词。检查拼写后再试一次。' : code === 'NETWORK_ERROR' ? '词典暂时未加载成功。检查网络后重试。' : errorMessage(e)); } }
    finally { if (mounted.current && seq === sequence.current) setLoading(false); }
  };
  useEffect(() => { if (request && handled.current !== request.id) { handled.current = request.id; void lookup(request.word,request.record); } }, [request]);
  const retrySave = async () => { if (saving) return; const entry = pending.current, seq = sequence.current; setSaving(true); try { if(entry) { await notebookService.recordSuccessfulSearch(entry.word,entry.id); pending.current = undefined; if(mounted.current && seq === sequence.current) setReceipt('本次查询记录已保存'); } await refresh(); if(mounted.current && seq === sequence.current) setSaveError(''); } catch(e) { if(mounted.current && seq === sequence.current) setSaveError(errorMessage(e)); } finally { if(mounted.current) setSaving(false); } };
  const active = snapshot.personalWords.filter(p => !p.paused);
  const due = snapshot.progress.filter(p => p.dueAt && p.dueAt <= Date.now() && active.some(w => w.wordId === p.wordId)).length;
  const newCount = snapshot.progress.filter(p => p.status === 'new' && active.some(w => w.wordId === p.wordId)).length;
  const recent = [...snapshot.history].sort((a,b) => b.lastSearchedAt-a.lastSearchedAt).slice(0,6);
  return <div className="search-page page-enter">
    {!word && <header className="search-intro"><div className="eyebrow"><span className="tiny-line" /> A SMALL WORD, A WIDER WORLD</div><h1>一个词，<br /><span>多种可能。</span></h1><p className="muted">查见词义，记下新知。让每一次好奇，都成为你的积累。</p><span className="intro-index" aria-hidden="true">Aa</span></header>}
    <form className="search-form" onSubmit={e => { e.preventDefault(); void lookup(input); }}><label htmlFor="word-search">查找英文单词</label><div className="search-control"><input id="word-search" type="search" value={input} onChange={e => setInput(e.target.value)} maxLength={80} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="输入一个英文单词…" aria-describedby="search-tip" /><button className="button button-primary search-submit" type="submit" disabled={loading} aria-label={loading ? '查询中…' : '查词'} aria-busy={loading}><Search size={23} aria-hidden="true" /></button></div><div id="search-tip" className="search-tip"><span>{word ? '每一次成功查词，都会自动记录。' : '从一个词开始'}</span>{!word && <div className="example-links"><span>试试看</span>{['serendipity','bank','light','spring'].map(w => <button type="button" lang="en" key={w} onClick={() => void lookup(w)}>{w}<ArrowUpRight size={12} /></button>)}</div>}</div></form>
    {error && <div className="notice notice-error" role="alert"><p>{error}</p><button className="button" onClick={() => void lookup(input)}>重试查询</button></div>}
    <div className={`search-layout ${!word ? 'search-layout-empty' : ''}`} aria-busy={loading}>
      <main className="entry-area">{word ? <div className="word-reveal" key={word.id}><div className="word-topline"><span className="eyebrow">THE DICTIONARY / 词典</span><span className="pill">{snapshot.personalWords.find(w => w.wordId === word.id)?.paused ? '学习已暂停' : '英文词条'}</span></div><h1 className="word-title serif" lang="en">{word.word}</h1><div className="word-receipt"><span role="status">{receipt && <><Check size={16} />{receipt}</>}</span><button className="button button-ghost" disabled={!snapshot.personalWords.some(p => p.wordId === word.id)} onClick={() => setEdit(true)}><SlidersHorizontal size={16} />整理到词本</button></div>{saveError && <div className="notice notice-error" role="alert">{saveError}<button className="button" disabled={saving || loading} onClick={() => void retrySave()}>{saving ? '处理中…' : pending.current ? '再次保存' : '重新读取'}</button></div>}<WordContent word={word} onSearch={q => void lookup(q)} /><section className="entry-note"><div className="section-label"><span>个人笔记</span><button className="text-button" onClick={() => setEdit(true)} disabled={!snapshot.personalWords.some(p => p.wordId === word.id)}>编辑笔记<ArrowUpRight size={15} /></button></div><p>{snapshot.personalWords.find(p => p.wordId === word.id)?.note || '记录一个联想，让这个词与你有关。'}</p></section></div> : <section className="first-word"><span className="section-number">01 / DISCOVER</span><h2>好奇，是最好的开始。</h2><p className="muted">中文释义看清词意，英文义项理解细节。<br />按含义区分的近义词，让表达多一种选择。</p><div className="dictionary-mark" aria-hidden="true"><BookOpen size={70} strokeWidth={1} /><span>LOOK IT UP.<br />MAKE IT YOURS.</span></div></section>}</main>
      <aside className="context-rail"><section className="review-panel"><div className="section-label"><span>今日复习</span><span className="mini-dot" /></div><div className="review-number serif">{due.toString().padStart(2,'0')}<span>个词待复习</span></div><p className="muted">{newCount ? `还有 ${newCount} 个新词，等你认识。` : '把遇见的词，慢慢变成熟悉。'}</p><button className="button button-primary" onClick={() => navigate('study')}>开始学习<ArrowRight size={17} /></button></section><section className="recent-panel"><div className="section-label"><span>最近查询</span><span className="source-tag">YOUR TRAIL</span></div>{recent.length ? <ul className="recent-list">{recent.map((h,i) => { const w = snapshot.words.find(w => w.id === h.wordId); return w && <li key={h.wordId}><button onClick={() => void lookup(w.word)}><span className="recent-index">{String(i+1).padStart(2,'0')}</span><span className="serif" lang="en">{w.word}</span><ArrowUpRight size={16} /></button><span className="recent-date">{dateLabel(h.lastSearchedAt,preferences.timeZone)}</span></li>; })}</ul> : <div className="quiet-empty"><BookOpen size={26} strokeWidth={1.3} /><p>你的词汇足迹，<br />将从这里开始。</p></div>}</section><div className="rail-footnote"><span className="tiny-line" />每一个词，都值得再遇见。</div></aside>
    </div>{edit && word && <WordEditor key={word.id} word={word} snapshot={snapshot} refresh={refresh} notify={notify} onClose={() => setEdit(false)} />}
  </div>;
}
