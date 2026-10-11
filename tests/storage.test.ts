import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/storage/database';
import { notebookService } from '../src/services/notebooks';
import { studyService } from '../src/services/study';
import type { WordEntry } from '../src/types';

const word = (name = 'bank'): WordEntry => ({ id: `en:${name}`, word: name, normalizedWord: name, phonetics: ['bæŋk'], chineseGlosses: [{ pos: 'n.', text: '银行；河岸', source: 'ECDICT' }], englishSenses: [{ id: `wn:${name}`, pos: 'n', definition: 'a financial institution', synonyms: ['depository financial institution'], examples: [], source: 'WordNet' }], sources: ['ECDICT', 'WordNet'], dataVersion: 'test-1', contentStatus: { chinese: true, english: true } });

beforeEach(async () => { await db.delete(); await db.open(); await notebookService.initialize(); });
afterEach(() => { db.close(); });

describe('transactional personal vocabulary', () => {
  it('records concurrent retries only once and keeps personal data on later searches', async () => {
    const saved = await Promise.all([notebookService.recordSuccessfulSearch(word(), 'search-1'), notebookService.recordSuccessfulSearch(word(), 'search-1')]);
    expect(saved.filter(s => s.isNew)).toHaveLength(1);
    const notebook = await notebookService.create('Finance');
    await notebookService.setMembership('en:bank', [notebook.id, notebook.id, 'all']);
    await notebookService.updateNote('en:bank', 'my note');
    await notebookService.pause('en:bank', true);
    await notebookService.recordSuccessfulSearch({ ...word(), word: 'Bank' }, 'search-2');
    const snapshot = await notebookService.getSnapshot();
    expect(snapshot.personalWords).toHaveLength(1);
    expect(snapshot.personalWords[0]).toMatchObject({ note: 'my note', paused: true });
    expect(snapshot.memberships).toHaveLength(1);
    expect(snapshot.history[0].searchCount).toBe(2);
  });

  it('rejects mismatched action IDs without writing another word', async () => {
    await notebookService.recordSuccessfulSearch(word(), 'same');
    await expect(notebookService.recordSuccessfulSearch(word('light'), 'same')).rejects.toThrow('不匹配');
    expect(await db.words.count()).toBe(1);
    expect(await db.personalWords.count()).toBe(1);
  });

  it('protects the default notebook, checks case-insensitive names and preserves words when deleting a notebook', async () => {
    await notebookService.recordSuccessfulSearch(word(), 'search');
    const notebook = await notebookService.create('Reading');
    await expect(notebookService.create(' reading ')).rejects.toThrow('同名');
    await expect(notebookService.rename('all', 'other')).rejects.toThrow();
    await expect(notebookService.deleteNotebook('all')).rejects.toThrow();
    await notebookService.setMembership('en:bank', [notebook.id]);
    await notebookService.deleteNotebook(notebook.id);
    expect(await db.personalWords.count()).toBe(1);
    expect(await db.memberships.count()).toBe(0);
  });

  it('deletion removes progress and remaining session cards and undo restores classification', async () => {
    await notebookService.recordSuccessfulSearch(word(), 'bank');
    await notebookService.recordSuccessfulSearch(word('light'), 'light');
    const notebook = await notebookService.create('Reading');
    await notebookService.setMembership('en:bank', [notebook.id]);
    const session = await studyService.startSession(['all'], 'flashcard', 20);
    const undo = await notebookService.deleteWord('en:bank');
    expect((await db.sessions.get(session.id))?.queue).toEqual(['en:light']);
    expect(await db.progress.get('en:bank')).toBeUndefined();
    await undo();
    await undo();
    expect(await db.personalWords.count()).toBe(2);
    expect(await db.memberships.count()).toBe(1);
  });

  it('clearing search history keeps notes, progress and personal words', async () => {
    await notebookService.recordSuccessfulSearch(word(), 'search');
    await notebookService.updateNote('en:bank', 'note');
    const session = await studyService.startSession(['all'], 'flashcard', 1);
    await studyService.submitReview(session.id, 'en:bank', 'remembered');
    await notebookService.clearHistory();
    expect(await db.searchEvents.count()).toBe(0);
    expect(await db.history.count()).toBe(0);
    expect((await db.progress.get('en:bank'))?.stage).toBe(0);
    expect((await db.personalWords.get('en:bank'))?.note).toBe('note');
  });
});

describe('backup merge', () => {
  it('prunes words paused by a newer import from the active round without importing sessions', async () => {
    await notebookService.recordSuccessfulSearch(word(), 'bank');
    await notebookService.recordSuccessfulSearch(word('light'), 'light');
    const session = await studyService.startSession(['all'], 'flashcard', 2);
    const backup = await notebookService.exportBackup();
    const importedBank = backup.personalWords.find(p => p.wordId === 'en:bank')!;
    importedBank.paused = true;
    importedBank.updatedAt = Date.now() + 1;
    await notebookService.importBackup(await notebookService.previewImport(JSON.stringify(backup)));
    const resumed = await studyService.resumeSession();
    expect(resumed).toMatchObject({ id: session.id, queue: ['en:light'], cursor: 0 });
    expect((await db.personalWords.get('en:bank'))?.paused).toBe(true);
    const finished = await studyService.submitReview(session.id, 'en:light', 'remembered', { expectedCursor: 0 });
    expect(finished.finishedAt).toBeDefined();
  });

  it('exports and restores historical events after deleting their personal word without resurrecting it', async () => {
    await notebookService.recordSuccessfulSearch(word(), 'search');
    const session = await studyService.startSession(['all'], 'flashcard', 1);
    await studyService.submitReview(session.id, 'en:bank', 'remembered');
    await notebookService.deleteWord('en:bank');
    const backup = await notebookService.exportBackup();
    expect(backup.words).toHaveLength(0);
    expect(backup.reviews).toHaveLength(1);
    await db.delete(); await db.open(); await notebookService.initialize();
    await notebookService.importBackup(await notebookService.previewImport(JSON.stringify(backup)));
    expect(await db.personalWords.count()).toBe(0);
    expect(await db.progress.count()).toBe(0);
    expect(await db.reviews.count()).toBe(1);
    expect((await db.history.get('en:bank'))?.searchCount).toBe(1);
    expect(await studyService.resumeSession()).toBeUndefined();
  });

  it('restores a clean database and repeated import does not duplicate logs or notes', async () => {
    await notebookService.recordSuccessfulSearch(word(), 'search');
    await notebookService.updateNote('en:bank', 'original');
    const notebook = await notebookService.create('Reading');
    await notebookService.setMembership('en:bank', [notebook.id]);
    const exported = await notebookService.exportBackup();
    await db.delete(); await db.open(); await notebookService.initialize();
    const preview = await notebookService.previewImport(JSON.stringify(exported));
    expect(preview).toMatchObject({ addedWords: 1, conflicts: 0, invalidRecords: 0 });
    await notebookService.importBackup(preview);
    await notebookService.updateNote('en:bank', 'local');
    await notebookService.importBackup(preview);
    await notebookService.importBackup(preview);
    expect((await db.personalWords.get('en:bank'))?.note).toBe('local\n\n[导入备份笔记]\noriginal');
    expect((await db.history.get('en:bank'))?.searchCount).toBe(1);
    expect(await db.memberships.count()).toBe(1);
  });

  it('uses later progress instead of summing counters; merges same names and remaps colliding notebook IDs', async () => {
    await notebookService.recordSuccessfulSearch(word(), 'local-search');
    const sameName = await notebookService.create('Reading');
    const clash = await notebookService.create('Work');
    const backup = await notebookService.exportBackup();
    backup.notebooks = [backup.notebooks[0], { ...sameName, id: 'incoming-reading', name: 'reading' }, { ...clash, name: 'Travel' }];
    backup.memberships = [{ notebookId: 'incoming-reading', wordId: 'en:bank', addedAt: 1 }, { notebookId: clash.id, wordId: 'en:bank', addedAt: 1 }];
    backup.progress[0] = { ...backup.progress[0], stage: 1, status: 'learning', dueAt: Date.now() + 1000, lastReviewedAt: Date.now(), updatedAt: Date.now() + 10, reviewCount: 2, version: 2 };
    backup.searchEvents.push({ id: 'incoming-search', wordId: 'en:bank', searchedAt: 1 });
    await notebookService.importBackup(await notebookService.previewImport(JSON.stringify(backup)));
    const snapshot = await notebookService.getSnapshot();
    expect(snapshot.notebooks).toHaveLength(4);
    expect(snapshot.memberships.some(m => m.notebookId === sameName.id)).toBe(true);
    expect(snapshot.memberships.some(m => m.notebookId === clash.id)).toBe(false);
    expect(snapshot.progress[0].reviewCount).toBe(2);
    expect(snapshot.history[0].searchCount).toBe(2);
  });

  it('rejects invalid relationships, malformed or oversized files before mutation', async () => {
    await notebookService.recordSuccessfulSearch(word(), 'search');
    const backup = await notebookService.exportBackup();
    backup.memberships.push({ notebookId: 'missing', wordId: 'en:bank', addedAt: 1 });
    await expect(notebookService.previewImport(JSON.stringify(backup))).rejects.toThrow('关联关系');
    await expect(notebookService.previewImport('{')).rejects.toThrow('JSON');
    await expect(notebookService.previewImport(' '.repeat(20 * 1024 * 1024 + 1))).rejects.toThrow('20 MiB');
    expect(await db.personalWords.count()).toBe(1);
  });

  it('rolls back earlier notebook and word writes when a later event conflicts', async () => {
    await notebookService.recordSuccessfulSearch(word(), 'collision');
    const backup = await notebookService.exportBackup();
    backup.words.push(word('light'));
    backup.personalWords.push({ wordId: 'en:light', addedAt: 1, updatedAt: 1, note: '', paused: false });
    backup.notebooks.push({ id: 'incoming', name: 'Travel', isDefault: false, createdAt: 1, updatedAt: 1 });
    backup.searchEvents = [{ id: 'collision', wordId: 'en:light', searchedAt: 1 }];
    const preview = await notebookService.previewImport(JSON.stringify(backup));
    await expect(notebookService.importBackup(preview)).rejects.toThrow('回滚');
    expect(await db.notebooks.count()).toBe(1);
    expect(await db.personalWords.count()).toBe(1);
    expect(await db.words.get('en:light')).toBeUndefined();
  });
});
