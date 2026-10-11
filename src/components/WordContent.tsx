import { useState } from 'react';
import { ArrowUpRight, Volume2 } from 'lucide-react';
import type { WordEntry } from '../types';
export default function WordContent({ word, onSearch, compact = false }: { word: WordEntry; onSearch?: (word: string) => void; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const senses = expanded ? word.englishSenses : word.englishSenses.slice(0, compact ? 3 : 6);
  const speak = () => { const utterance = new SpeechSynthesisUtterance(word.word); utterance.lang = 'en-US'; speechSynthesis.cancel(); speechSynthesis.speak(utterance); };
  return <div className="word-content">
    {!compact && <div className="phonetics"><span lang="en">{word.phonetics.length ? word.phonetics.map(p => `/${p.replace(/^\/+|\/+$/g, '')}/`).join(' · ') : '暂无音标'}</span>{'speechSynthesis' in window && <button className="icon-button" aria-label={`使用浏览器语音朗读 ${word.word}`} title="浏览器语音朗读" onClick={speak}><Volume2 size={19} /></button>}</div>}
    <section className="chinese-section"><div className="section-label"><span>中文释义</span><span className="source-tag">ECDICT</span></div>{word.chineseGlosses.length ? word.chineseGlosses.map((g,i) => <p key={i}>{g.text}</p>) : <p className="muted">该词暂无中文释义。</p>}</section>
    <section className="english-section"><div className="section-label"><span>英文义项</span><span className="source-tag">{word.englishSenses.length} senses</span></div>{senses.map((sense,i) => <article className="sense" key={sense.id}><span className="sense-index">{String(i + 1).padStart(2, '0')}</span><div className="sense-body"><div className="sense-meta"><span className="pos" lang="en">{sense.pos}</span><span>{sense.source}</span></div><p className="definition" lang="en">{sense.definition}</p>{sense.examples.map((e,j) => <p className="example" lang="en" key={j}>“{e}”</p>)}{sense.synonyms.length ? <div className="synonyms"><span className="muted">近义词</span>{sense.synonyms.map(s => onSearch ? <button className="synonym" lang="en" key={s} onClick={() => onSearch(s)}>{s}<ArrowUpRight size={13} /></button> : <span className="synonym" lang="en" key={s}>{s}</span>)}</div> : <p className="muted no-synonyms">该含义暂无近义词</p>}</div></article>)}{!word.englishSenses.length && <p className="muted">该词暂无英文义项。</p>}{word.englishSenses.length > (compact ? 3 : 6) && <button className="button button-ghost expand-button" onClick={() => setExpanded(!expanded)}>{expanded ? '收起义项' : `展开其余 ${word.englishSenses.length - (compact ? 3 : 6)} 条义项`}</button>}</section>
    {!compact && <p className="source-note">来源：{word.sources.join(' · ')} · {word.dataVersion}<br />中文释义汇总与英文义项分别来自原词库，序号不代表逐条翻译对应。</p>}
  </div>;
}
