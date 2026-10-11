import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Settings as SettingsIcon, X } from 'lucide-react';
import type { Preferences, Snapshot } from './types';
import { notebookService } from './services/notebooks';
import SearchPage from './pages/SearchPage';
import { errorMessage } from './utils';
const NotebooksPage = lazy(() => import('./pages/NotebooksPage'));
const StudyPage = lazy(() => import('./pages/StudyPage'));
const Settings = lazy(() => import('./components/Settings'));
const empty: Snapshot = { words:[],personalWords:[],notebooks:[],memberships:[],history:[],progress:[],reviews:[] };
const readPrefs = (): Preferences => { const defaults = {timeZone:'Asia/Shanghai',studyLimit:20,shortcuts:true}; try { const raw = JSON.parse(localStorage.getItem('words.preferences') || 'null'); if(!raw) return defaults; new Intl.DateTimeFormat('zh-CN',{timeZone:raw.timeZone}).format(); return {...defaults,timeZone:raw.timeZone,studyLimit:[5,10,15,20].includes(raw.studyLimit)?raw.studyLimit:20,shortcuts:raw.shortcuts!==false}; } catch { return defaults; } };
export default function App() {
  const [snapshot,setSnapshot] = useState<Snapshot>(empty);
  const [page,setPage] = useState('search');
  const [request,setRequest] = useState<{word:string;id:string;record:boolean}>();
  const [settings,setSettings] = useState(false);
  const [preferences,setPrefs] = useState(readPrefs);
  const [loading,setLoading] = useState(true);
  const [error,setError] = useState('');
  const [toast,setToast] = useState('');
  const [undo,setUndo] = useState<(() => Promise<void>)>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const channel = useRef<BroadcastChannel | undefined>(undefined);
  const explicitQuery = useRef<string | undefined>(undefined);
  const readSnapshot = useCallback(async () => setSnapshot(await notebookService.getSnapshot()),[]);
  const refresh = useCallback(async () => { await readSnapshot(); channel.current?.postMessage('changed'); },[readSnapshot]);
  const notify = (message:string) => { setToast(message); setUndo(undefined); clearTimeout(timer.current); timer.current = setTimeout(() => setToast(''),5000); };
  const initialize = useCallback(async () => { setLoading(true); setError(''); try { await notebookService.initialize(); await readSnapshot(); } catch(e) { setError(`本地数据暂时无法读取：${errorMessage(e)}`); } finally { setLoading(false); } },[readSnapshot]);
  useEffect(() => { void initialize(); if ('BroadcastChannel' in window) { channel.current = new BroadcastChannel('words.data'); channel.current.onmessage = () => { void readSnapshot().catch(e => setError(errorMessage(e))); }; } const onFocus = () => void readSnapshot().catch(e => setError(errorMessage(e))); window.addEventListener('focus',onFocus); return () => { channel.current?.close(); window.removeEventListener('focus',onFocus); clearTimeout(timer.current); }; },[initialize,readSnapshot]);
  useEffect(() => { const changed = () => { const [path,params] = location.hash.slice(2).split('?'); const next = ['search','notebooks','study'].includes(path) ? path : 'search'; setPage(next); const query = new URLSearchParams(params).get('q'); const record = explicitQuery.current === location.hash; explicitQuery.current = undefined; setRequest(next==='search'&&query ? {word:query,id:crypto.randomUUID(),record} : undefined); }; changed(); window.addEventListener('hashchange',changed); return () => window.removeEventListener('hashchange',changed); },[]);
  useEffect(() => { document.title = `WORDS. — ${{search:'查词',notebooks:'单词本',study:'学习'}[page]}`; },[page]);
  useEffect(() => { window.scrollTo(0,0); document.getElementById('main-content')?.focus({preventScroll:true}); },[page]);
  const navigate = (next:string,word?:string) => { const hash = `#/${next}${word ? `?q=${encodeURIComponent(word)}` : ''}`; if(location.hash===hash) { setPage(next); if(word) setRequest({word,id:crypto.randomUUID(),record:true}); } else { explicitQuery.current = word ? hash : undefined; location.hash=hash; } };
  const setPreferences = (p:Preferences) => { localStorage.setItem('words.preferences',JSON.stringify(p)); setPrefs(p); };
  const onUndo = (fn:()=>Promise<void>) => { setUndo(() => fn); setToast('单词已删除'); clearTimeout(timer.current); timer.current=setTimeout(() => { setUndo(undefined); setToast(''); },12000); };
  return <div className="app-shell"><a href="#main-content" className="skip-link" onClick={e => {e.preventDefault(); document.getElementById('main-content')?.focus();}}>跳到主要内容</a><header className="app-header"><a className="brand" href="#/search" aria-label="WORDS 首页">WORDS<span>.</span><i aria-hidden="true" /></a><nav aria-label="主导航">{[['search','查词'],['notebooks','单词本'],['study','学习']].map(([id,label]) => <a href={`#/${id}`} key={id} className={page===id?'active':''} aria-current={page===id?'page':undefined}>{label}</a>)}</nav><button className="settings-trigger" onClick={() => setSettings(true)} aria-label="打开设置与数据"><SettingsIcon size={19}/><span>设置</span></button></header>
    <div id="main-content" className="main-container" tabIndex={-1}>{loading ? <div className="app-loading" role="status"><span className="serif">Opening your words…</span><p>正在打开你的单词本</p></div> : error ? <div className="notice notice-error" role="alert"><p>{error}</p><button className="button" onClick={() => void initialize()}>重试读取数据</button></div> : <Suspense fallback={<p className="app-loading" role="status">正在打开页面…</p>}>{page==='search' ? <SearchPage snapshot={snapshot} refresh={refresh} notify={notify} request={request} preferences={preferences} navigate={navigate}/> : page==='notebooks' ? <NotebooksPage snapshot={snapshot} refresh={refresh} notify={notify} preferences={preferences} navigate={navigate} onUndo={onUndo}/> : <StudyPage snapshot={snapshot} refresh={refresh} notify={notify} preferences={preferences}/>}</Suspense>}</div>
    <footer className="app-footer"><span className="footer-brand">WORDS.</span><span>查见 · 记下 · 再遇见</span><span className="footer-right">一词一页，日积月累。<ArrowUpRight size={15}/></span></footer>
    {settings && <Suspense fallback={null}><Settings snapshot={snapshot} preferences={preferences} setPreferences={setPreferences} refresh={refresh} notify={notify} onClose={() => setSettings(false)}/></Suspense>}{toast && <div className="toast" role="status"><span>{toast}</span>{undo && <button onClick={async () => { try { await undo(); await refresh(); notify('删除已撤销'); } catch(e) { notify(`撤销失败：${errorMessage(e)}`); } }}>撤销</button>}<button aria-label="关闭提示" onClick={() => {setToast('');setUndo(undefined);}}><X size={16}/></button></div>}
  </div>;
}
