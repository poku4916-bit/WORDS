import { StrictMode, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowLeft, ArrowRight, BookOpen, CheckCircle2, RotateCcw } from 'lucide-react';
import type { WordEntry } from './types';
import { dictionaryService } from './services/dictionary';
import { errorMessage } from './utils';
import WordContent from './components/WordContent';
import Modal from './components/Modal';
import '@fontsource/newsreader/latin-400.css';
import '@fontsource/newsreader/latin-400-italic.css';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import './styles/main.css';
import './styles/study.css';
import './styles/showcase.css';

const noteFixture = '【测试数据】这段长笔记只用于检查换行、中文行距、滚动与手机安全区域。它不是个人记录，也不会进入单词本。'.repeat(12)
  + '\n\n【连续字符测试】abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.repeat(4);

export default function ComponentShowcase() {
  const [word, setWord] = useState<WordEntry>();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [testInput, setTestInput] = useState('');
  const [testStatus, setTestStatus] = useState('');
  const entryRegion = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true); setLoadError('');
    void dictionaryService.lookup('light').then(entry => { if (active) setWord(entry); }).catch(error => {
      if (active) setLoadError(errorMessage(error));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [attempt]);

  useEffect(() => {
    // Exercise the real component's existing expansion control without changing its production API.
    const expand = entryRegion.current?.querySelector<HTMLButtonElement>('.expand-button');
    if (word && expand?.textContent?.startsWith('展开其余')) expand.click();
  }, [word]);

  return <div className="app-shell showcase-shell">
    <header className="showcase-header"><a className="brand" href="./" aria-label="回到 WORDS 应用">WORDS<span>.</span></a><span className="pill">内部开发检查</span><a className="button button-ghost" href="./"><ArrowLeft size={17} />返回应用</a></header>
    <main className="showcase-main"><header className="page-heading"><div><span className="eyebrow">DEVELOPMENT ONLY / COMPONENT CHECK</span><h1>组件、内容与边界。</h1><p className="muted">此页仅供开发检查，不出现在产品导航。词典请求只读；所有演示操作只改变此页状态。</p></div></header>
      <section className="showcase-section panel" aria-labelledby="showcase-controls-title"><span className="eyebrow">TEST STATES / 控件测试</span><h2 id="showcase-controls-title">按钮、输入与焦点</h2><p className="muted">使用 Tab 检查焦点环；打开弹窗后检查焦点限制、Escape 关闭与焦点返回。</p><div className="showcase-button-row"><button className="button button-primary" onClick={() => setTestStatus('测试状态：主要按钮已点击。页面没有写入个人数据。')}>主要操作<ArrowRight size={17} /></button><button className="button" onClick={() => setTestStatus('测试状态：次要按钮已点击。')}>次要操作</button><button className="button button-ghost" onClick={() => setDialogOpen(true)}>打开焦点测试弹窗</button><button className="button" disabled>禁用状态</button></div><form className="showcase-test-form" onSubmit={event => { event.preventDefault(); setTestStatus(`测试状态：表单输入为“${testInput || '空'}”，未保存到词本。`); }}><label className="field">测试输入<input value={testInput} onChange={event => setTestInput(event.target.value)} maxLength={80} placeholder="仅用于检查输入与键盘焦点" /></label><button className="button" type="submit">提交测试输入</button></form>{testStatus && <p className="notice" role="status">{testStatus}</p>}</section>
      <div className="showcase-state-grid"><section className="showcase-section panel"><span className="eyebrow">TEST STATES / 空状态模拟</span><div className="empty-state"><BookOpen size={34} strokeWidth={1.2} /><h3>测试状态：词本为空</h3><p className="muted">这是用于检查布局的模拟空状态，不代表当前个人词本。</p><button className="button button-primary" onClick={() => setTestStatus('测试状态：空状态按钮已点击。')}>测试空状态操作<ArrowRight size={16} /></button></div></section><section className="showcase-section panel"><span className="eyebrow">TEST STATES / 错误与反馈模拟</span><div className="notice notice-error" role="alert"><p>测试状态：模拟词典分片读取失败。此提示不表示当前词库异常。</p><button className="button" onClick={() => setTestStatus('测试状态：模拟重试已触发，不执行网络或存储操作。')}><RotateCcw size={16} />模拟重试</button></div><div className="notice showcase-success"><CheckCircle2 size={20} /><p>测试状态：成功反馈文字。此回执只用于检查样式。</p></div><div className="showcase-pills"><span className="pill status-new">新词（测试）</span><span className="pill status-learning">学习中（测试）</span><span className="pill status-familiar">已熟悉（测试）</span><span className="pill status-paused">已暂停（测试）</span></div></section></div>
      <section className="showcase-section showcase-study" aria-labelledby="showcase-dictionary-title"><div className="showcase-section-heading"><div><span className="eyebrow">REAL DICTIONARY / 只读长内容检查</span><h2 id="showcase-dictionary-title">真实词条与全部义项</h2><p className="muted">从本站词典实际查询 <span lang="en">light</span>，自动展开全部英文义项；保留真实释义、近义词和来源。</p></div>{word && <span className="pill">实际返回 {word.englishSenses.length} 条英文义项</span>}</div>{loading && <p className="notice" role="status">正在只读加载真实词条…</p>}{loadError && <div className="notice notice-error" role="alert"><p>真实请求失败：{loadError}</p><button className="button" onClick={() => setAttempt(value => value + 1)}>重试读取词典</button></div>}{word && <div className="showcase-word-stage"><article className="study-card"><div className="study-card-topline"><span className="eyebrow">REAL CONTENT / NO PERSONAL DATA</span><span className="study-card-number">只读</span></div><h3 className="serif showcase-word-title" lang="en">{word.word}</h3><div ref={entryRegion}><WordContent key={word.id} word={word} /></div><section className="study-personal-note showcase-fixture"><span className="eyebrow">TEST DATA / 长笔记测试数据</span><p>{noteFixture}</p></section></article><div className="study-actions showcase-mock-actions" aria-label="测试状态：手机学习操作区"><div className="study-rating-buttons">{['忘记', '模糊', '记住'].map((label, index) => <button className={`button study-rating ${index === 2 ? 'button-primary' : ''}`} key={label} onClick={() => setTestStatus(`测试状态：已点击“${label}”。未记录学习评分。`)}><span>{label}</span><small>仅测试按钮</small></button>)}</div></div></div>}</section>
    </main><footer className="app-footer"><span className="footer-brand">WORDS.</span><span>开发检查页 · 测试数据不进入词本</span></footer>
    {dialogOpen && <Modal title="测试弹窗：焦点与长文本" onClose={() => setDialogOpen(false)}><p>测试状态：Tab 应留在弹窗内，Escape 关闭后焦点应回到“打开焦点测试弹窗”按钮。</p><label className="field">弹窗内测试输入<input autoFocus placeholder="测试数据，不保存" /></label><p className="muted">以下长文本也是测试数据，用于检查弹窗的自然滚动与手机视口。</p><p className="showcase-dialog-fixture">{noteFixture.slice(0, 320)}</p><div className="modal-actions"><button className="button" onClick={() => setDialogOpen(false)}>关闭测试弹窗</button><button className="button button-primary" onClick={() => { setTestStatus('测试状态：弹窗操作完成，未写入个人数据。'); setDialogOpen(false); }}>完成焦点测试</button></div></Modal>}
  </div>;
}

const root = document.getElementById('root');
if (root && import.meta.env.DEV) createRoot(root).render(<StrictMode><ComponentShowcase /></StrictMode>);
else if (root) root.textContent = '此组件检查页仅在开发环境提供。';
