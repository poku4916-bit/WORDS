import { useState } from 'react';
import type { Snapshot, WordEntry } from '../types';
import { notebookService } from '../services/notebooks';
import Modal from './Modal';
import WordContent from './WordContent';
import { errorMessage } from '../utils';
export default function WordEditor({ word, snapshot, refresh, onClose, notify }: { word: WordEntry; snapshot: Snapshot; refresh: () => Promise<void>; onClose: () => void; notify: (message: string) => void }) {
  const personal = snapshot.personalWords.find(w => w.wordId === word.id);
  const [note, setNote] = useState(personal?.note || '');
  const [ids, setIds] = useState(snapshot.memberships.filter(m => m.wordId === word.id).map(m => m.notebookId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => { setBusy(true); setError(''); try { await notebookService.setMembership(word.id, ids); await notebookService.updateNote(word.id, note); await refresh(); notify('词本归属与笔记已保存'); onClose(); } catch(e) { setError(errorMessage(e)); } finally { setBusy(false); } };
  return <Modal title="整理这个词" onClose={onClose} wide><div className="editor-word serif" lang="en">{word.word}</div><fieldset className="membership-field"><legend>所属词本</legend><label className="check-row"><input type="checkbox" checked disabled />我的单词<span className="muted">默认收录</span></label>{snapshot.notebooks.filter(n => !n.isDefault).map(n => <label className="check-row" key={n.id}><input type="checkbox" checked={ids.includes(n.id)} onChange={e => setIds(e.target.checked ? [...ids,n.id] : ids.filter(id => id !== n.id))} />{n.name}</label>)}{snapshot.notebooks.length === 1 && <p className="muted">可在“单词本”页创建分类词本。</p>}</fieldset><label className="field">个人笔记<textarea value={note} onChange={e => setNote(e.target.value)} maxLength={10000} rows={4} placeholder="记录你的联想、使用场景或例句…" /></label>{error && <p className="notice notice-error" role="alert">{error}</p>}<div className="modal-actions"><button className="button" onClick={onClose}>取消</button><button className="button button-primary" disabled={busy} onClick={save}>{busy ? '保存中…' : '保存整理'}</button></div><details className="editor-details"><summary>查看完整释义</summary><WordContent word={word} /></details></Modal>;
}
