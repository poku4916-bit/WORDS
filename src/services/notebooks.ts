import type { Notebook, SearchHistory, Snapshot, WordEntry } from '../types';
import { db, DEFAULT_NOTEBOOK_ID, initialProgress, newId, normalizedKey } from '../storage/database';
import { parseBackup, validateBackup, validateWord, type Backup, type ImportPreview } from '../storage/backup';

export { DEFAULT_NOTEBOOK_ID };
export type { ImportPreview };

function checkedName(name: string): string {
  const result = name.trim();
  if (!result || result.length > 80) throw new Error('词本名称需为 1–80 个字符。');
  return result;
}

async function rebuildHistory() {
  const events = await db.searchEvents.toArray();
  const byWord = new Map<string, SearchHistory>();
  for (const event of events) {
    const history = byWord.get(event.wordId);
    if (history) { history.firstSearchedAt = Math.min(history.firstSearchedAt, event.searchedAt); history.lastSearchedAt = Math.max(history.lastSearchedAt, event.searchedAt); history.searchCount++; }
    else byWord.set(event.wordId, { wordId: event.wordId, firstSearchedAt: event.searchedAt, lastSearchedAt: event.searchedAt, searchCount: 1 });
  }
  await db.history.clear();
  await db.history.bulkPut([...byWord.values()]);
}

export const notebookService = {
  async initialize(): Promise<void> {
    await db.transaction('rw', db.notebooks, async () => {
      if (!await db.notebooks.get(DEFAULT_NOTEBOOK_ID)) {
        const now = Date.now();
        await db.notebooks.add({ id: DEFAULT_NOTEBOOK_ID, name: '我的单词', createdAt: now, updatedAt: now, isDefault: true });
      }
    });
  },

  async getSnapshot(): Promise<Snapshot> {
    await this.initialize();
    return db.transaction('r', [db.words, db.personalWords, db.notebooks, db.memberships, db.history, db.progress, db.reviews, db.sessions], async () => {
      const [words, personalWords, notebooks, memberships, history, progress, reviews, sessions] = await Promise.all([db.words.toArray(), db.personalWords.toArray(), db.notebooks.toArray(), db.memberships.toArray(), db.history.toArray(), db.progress.toArray(), db.reviews.toArray(), db.sessions.toArray()]);
      const session = sessions.filter(s => s.finishedAt === undefined).sort((a, b) => b.startedAt - a.startedAt)[0];
      return { words, personalWords, notebooks: notebooks.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.createdAt - b.createdAt), memberships, history: history.sort((a, b) => b.lastSearchedAt - a.lastSearchedAt), progress, reviews, session };
    });
  },

  async recordSuccessfulSearch(value: WordEntry, actionId: string): Promise<{ isNew: boolean }> {
    const word = validateWord(value);
    if (!actionId.trim() || actionId.length > 200) throw new Error('查询事件无效。');
    return db.transaction('rw', [db.words, db.personalWords, db.searchEvents, db.history, db.progress], async () => {
      const existingEvent = await db.searchEvents.get(actionId);
      if (existingEvent) {
        if (existingEvent.wordId !== word.id) throw new Error('查询事件与词条不匹配。');
        return { isNew: false };
      }
      const now = Date.now(), existing = await db.personalWords.get(word.id), history = await db.history.get(word.id);
      await db.searchEvents.add({ id: actionId, wordId: word.id, searchedAt: now });
      await db.words.put(word);
      if (!existing) {
        await db.personalWords.add({ wordId: word.id, addedAt: now, note: '', paused: false, updatedAt: now });
        await db.progress.put(initialProgress(word.id, now));
      }
      await db.history.put({ wordId: word.id, firstSearchedAt: Math.min(history?.firstSearchedAt ?? now, now), lastSearchedAt: Math.max(history?.lastSearchedAt ?? now, now), searchCount: (history?.searchCount ?? 0) + 1 });
      return { isNew: !existing };
    });
  },

  async create(name: string): Promise<Notebook> {
    const checked = checkedName(name);
    await this.initialize();
    return db.transaction('rw', db.notebooks, async () => {
      const notebooks = await db.notebooks.toArray();
      if (notebooks.some(n => normalizedKey(n.name) === normalizedKey(checked))) throw new Error('已存在同名词本。');
      const now = Date.now(), notebook = { id: newId('notebook'), name: checked, createdAt: now, updatedAt: now, isDefault: false };
      await db.notebooks.add(notebook);
      return notebook;
    });
  },

  async rename(id: string, name: string): Promise<void> {
    const checked = checkedName(name);
    if (id === DEFAULT_NOTEBOOK_ID) throw new Error('“我的单词”不能重命名。');
    await db.transaction('rw', db.notebooks, async () => {
      if (!await db.notebooks.get(id)) throw new Error('词本已不存在。');
      if ((await db.notebooks.toArray()).some(n => n.id !== id && normalizedKey(n.name) === normalizedKey(checked))) throw new Error('已存在同名词本。');
      await db.notebooks.update(id, { name: checked, updatedAt: Date.now() });
    });
  },

  async deleteNotebook(id: string): Promise<void> {
    if (id === DEFAULT_NOTEBOOK_ID) throw new Error('“我的单词”不能删除。');
    await db.transaction('rw', [db.notebooks, db.memberships], async () => {
      await db.notebooks.delete(id);
      await db.memberships.where('notebookId').equals(id).delete();
    });
  },

  async setMembership(wordId: string, notebookIds: string[]): Promise<void> {
    await db.transaction('rw', [db.personalWords, db.notebooks, db.memberships], async () => {
      if (!await db.personalWords.get(wordId)) throw new Error('单词已不存在。');
      const ids = [...new Set(notebookIds)].filter(id => id !== DEFAULT_NOTEBOOK_ID);
      for (const id of ids) if (!await db.notebooks.get(id)) throw new Error('所选词本已不存在。');
      const previous = await db.memberships.where('wordId').equals(wordId).toArray();
      await db.memberships.where('wordId').equals(wordId).delete();
      await db.memberships.bulkPut(ids.map(notebookId => ({ notebookId, wordId, addedAt: previous.find(m => m.notebookId === notebookId)?.addedAt ?? Date.now() })));
    });
  },

  async updateNote(wordId: string, note: string): Promise<void> {
    if (note.length > 20000) throw new Error('笔记最多 20,000 个字符。');
    if (!await db.personalWords.update(wordId, { note, updatedAt: Date.now() })) throw new Error('单词已不存在。');
  },

  async pause(wordId: string, paused: boolean): Promise<void> {
    await db.transaction('rw', [db.personalWords, db.sessions], async () => {
      if (!await db.personalWords.update(wordId, { paused, updatedAt: Date.now() })) throw new Error('单词已不存在。');
      if (paused) await removeFromActiveSessions(wordId);
    });
  },

  async deleteWord(wordId: string): Promise<() => Promise<void>> {
    const saved = await db.transaction('rw', [db.personalWords, db.progress, db.memberships, db.sessions], async () => {
      const personal = await db.personalWords.get(wordId), progress = await db.progress.get(wordId), memberships = await db.memberships.where('wordId').equals(wordId).toArray();
      if (!personal) throw new Error('单词已不存在。');
      await db.personalWords.delete(wordId);
      await db.progress.delete(wordId);
      await db.memberships.where('wordId').equals(wordId).delete();
      await removeFromActiveSessions(wordId);
      return { personal, progress, memberships };
    });
    let restored = false;
    return async () => {
      if (restored) return;
      await db.transaction('rw', [db.personalWords, db.progress, db.memberships, db.notebooks], async () => {
        if (await db.personalWords.get(wordId)) throw new Error('该词已重新收录，不能覆盖新记录。');
        await db.personalWords.add(saved.personal);
        if (saved.progress) await db.progress.put(saved.progress);
        for (const membership of saved.memberships) if (await db.notebooks.get(membership.notebookId)) await db.memberships.put(membership);
      });
      restored = true;
    };
  },

  async clearHistory(): Promise<void> {
    await db.transaction('rw', [db.history, db.searchEvents], async () => { await db.history.clear(); await db.searchEvents.clear(); });
  },

  async exportBackup(): Promise<Backup> {
    await this.initialize();
    return db.transaction('r', [db.words, db.personalWords, db.notebooks, db.memberships, db.searchEvents, db.history, db.progress, db.reviews], async () => {
      const [allWords, personalWords, notebooks, memberships, searchEvents, history, progress, reviews] = await Promise.all([db.words.toArray(), db.personalWords.toArray(), db.notebooks.toArray(), db.memberships.toArray(), db.searchEvents.toArray(), db.history.toArray(), db.progress.toArray(), db.reviews.toArray()]);
      const personalIds = new Set(personalWords.map(p => p.wordId)), words = allWords.filter(w => personalIds.has(w.id));
      return { schemaVersion: 1, exportedAt: Date.now(), dictionaryVersion: words[0]?.dataVersion ?? '', words, personalWords, notebooks, memberships, searchEvents, history, progress, reviews };
    });
  },

  async previewImport(text: string): Promise<ImportPreview> {
    const data = parseBackup(text), snapshot = await this.getSnapshot(), ids = new Set(snapshot.personalWords.map(p => p.wordId));
    return { addedWords: data.personalWords.filter(p => !ids.has(p.wordId)).length, conflicts: data.personalWords.filter(p => ids.has(p.wordId)).length, invalidRecords: 0, notebookCount: data.notebooks.filter(n => !n.isDefault).length, data };
  },

  async importBackup(preview: ImportPreview): Promise<void> {
    const data = validateBackup(preview.data);
    await this.initialize();
    await db.transaction('rw', [db.words, db.personalWords, db.notebooks, db.memberships, db.searchEvents, db.history, db.progress, db.reviews, db.sessions], async () => {
      const localNotebooks = await db.notebooks.toArray(), notebookMap = new Map<string, string>([[DEFAULT_NOTEBOOK_ID, DEFAULT_NOTEBOOK_ID]]);
      for (const incoming of data.notebooks.filter(n => !n.isDefault)) {
        const sameName = localNotebooks.find(n => normalizedKey(n.name) === normalizedKey(incoming.name));
        if (sameName) { notebookMap.set(incoming.id, sameName.id); continue; }
        const id = localNotebooks.some(n => n.id === incoming.id) ? newId('notebook') : incoming.id;
        const notebook = { ...incoming, id };
        await db.notebooks.add(notebook); localNotebooks.push(notebook); notebookMap.set(incoming.id, id);
      }
      for (const word of data.words) if (!await db.words.get(word.id)) await db.words.add(word);
      for (const incoming of data.personalWords) {
        const local = await db.personalWords.get(incoming.wordId);
        if (!local) { await db.personalWords.add(incoming); if (incoming.paused) await removeFromActiveSessions(incoming.wordId); continue; }
        let note = local.note;
        if (incoming.note && incoming.note !== local.note && !local.note.split('\n\n[导入备份笔记]\n').includes(incoming.note)) note = local.note ? `${local.note}\n\n[导入备份笔记]\n${incoming.note}` : incoming.note;
        if (note.length > 20000) throw new Error('合并后的笔记超过长度上限，导入已回滚。');
        const winner = incoming.updatedAt > local.updatedAt ? incoming : local;
        await db.personalWords.put({ ...winner, addedAt: Math.min(local.addedAt, incoming.addedAt), note });
        if (winner.paused) await removeFromActiveSessions(incoming.wordId);
      }
      for (const membership of data.memberships) {
        const notebookId = notebookMap.get(membership.notebookId)!;
        if (!await db.memberships.get([notebookId, membership.wordId])) await db.memberships.add({ ...membership, notebookId });
      }
      for (const incoming of data.progress) {
        const local = await db.progress.get(incoming.wordId);
        if (!local) await db.progress.put(incoming);
        else if (incoming.updatedAt > local.updatedAt) await db.progress.put({ ...incoming, version: Math.max(incoming.version, local.version) + 1 });
      }
      for (const incoming of data.searchEvents) {
        const local = await db.searchEvents.get(incoming.id);
        if (local && local.wordId !== incoming.wordId) throw new Error('查询事件 ID 冲突，导入已回滚。');
        if (!local) await db.searchEvents.add(incoming);
      }
      for (const incoming of data.reviews) {
        const local = await db.reviews.get(incoming.id);
        if (local && (local.wordId !== incoming.wordId || local.sessionId !== incoming.sessionId)) throw new Error('复习事件 ID 冲突，导入已回滚。');
        if (!local) await db.reviews.add(incoming);
      }
      await rebuildHistory();
    });
  },
};

async function removeFromActiveSessions(wordId: string) {
  for (const session of (await db.sessions.toArray()).filter(s => s.finishedAt === undefined)) {
    const originalLength = session.queue.length;
    session.queue = session.queue.filter((id, index) => id !== wordId || index < session.cursor);
    session.retryQueue = session.retryQueue.filter((id, index) => id !== wordId || index + originalLength < session.cursor);
    if (session.cursor >= session.queue.length + session.retryQueue.length) session.finishedAt = Date.now();
    await db.sessions.put(session);
  }
}
