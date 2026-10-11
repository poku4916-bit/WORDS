import type { Notebook, NotebookWord, PersonalWord, ReviewEvent, SearchEvent, SearchHistory, StudyProgress, WordEntry } from '../types';
import { normalizedKey } from './database';

export interface Backup {
  schemaVersion: 1;
  exportedAt: number;
  dictionaryVersion: string;
  words: WordEntry[];
  personalWords: PersonalWord[];
  notebooks: Notebook[];
  memberships: NotebookWord[];
  searchEvents: SearchEvent[];
  history: SearchHistory[];
  progress: StudyProgress[];
  reviews: ReviewEvent[];
}

export interface ImportPreview {
  addedWords: number;
  conflicts: number;
  invalidRecords: number;
  notebookCount: number;
  data: Backup;
}

const MAX_BACKUP_BYTES = 20 * 1024 * 1024;
function fail(): never { throw new Error('备份格式或关联关系无效，未修改已有数据。'); }
function object(value: unknown): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(); return value as Record<string, unknown>; }
function string(value: unknown, max = 4000, allowEmpty = false): string { if (typeof value !== 'string' || value.length > max || (!allowEmpty && !value.trim())) fail(); return value; }
function bool(value: unknown): boolean { if (typeof value !== 'boolean') fail(); return value; }
function number(value: unknown, max = 8.64e15): number { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) fail(); return value; }
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number { const result = number(value, max); if (!Number.isSafeInteger(result)) fail(); return result; }
function array<T>(value: unknown, parse: (item: unknown) => T, max = 200000): T[] { if (!Array.isArray(value) || value.length > max) fail(); return value.map(parse); }
function unique<T>(values: T[], key: (item: T) => string): T[] { const keys = new Set<string>(); for (const value of values) { const id = key(value); if (keys.has(id)) fail(); keys.add(id); } return values; }
function wordId(value: unknown): string { const id = string(value, 83); if (!id.startsWith('en:') || id.slice(3) !== normalizedKey(id.slice(3)) || !id.slice(3)) fail(); return id; }

export function validateWord(value: unknown): WordEntry {
  const v = object(value);
  const word = string(v.word, 80);
  const normalizedWord = string(v.normalizedWord, 80);
  const id = wordId(v.id);
  if (normalizedWord !== normalizedKey(word) || id !== `en:${normalizedWord}`) fail();
  const chineseGlosses = array(v.chineseGlosses, value => { const g = object(value); return { ...(g.pos === undefined ? {} : { pos: string(g.pos, 40) }), text: string(g.text), source: string(g.source, 200) }; }, 200);
  const englishSenses = unique(array(v.englishSenses, value => { const s = object(value); return { id: string(s.id, 200), pos: string(s.pos, 40), definition: string(s.definition), synonyms: array(s.synonyms, v => string(v, 160), 300), examples: array(s.examples, v => string(v, 4000), 100), source: string(s.source, 200) }; }, 300), s => s.id);
  if (!chineseGlosses.length && !englishSenses.length) fail();
  const status = object(v.contentStatus);
  if (bool(status.chinese) !== !!chineseGlosses.length || bool(status.english) !== !!englishSenses.length) fail();
  return { id, word, normalizedWord, chineseGlosses, englishSenses, phonetics: array(v.phonetics, v => string(v, 200), 30), sources: array(v.sources, v => string(v, 200), 30), dataVersion: string(v.dataVersion, 200), contentStatus: { chinese: !!chineseGlosses.length, english: !!englishSenses.length } };
}

function parseProgress(value: unknown): StudyProgress {
  const v = object(value);
  if (!Number.isInteger(v.stage) || (v.stage as number) < -1 || (v.stage as number) > 4 || !['new', 'learning', 'familiar'].includes(v.status as string)) fail();
  const stage = v.stage as number;
  const status = v.status as StudyProgress['status'];
  const dueAt = v.dueAt === null ? null : number(v.dueAt);
  const lastReviewedAt = v.lastReviewedAt === null ? null : number(v.lastReviewedAt);
  if ((status === 'new' && (stage !== -1 || dueAt !== null || lastReviewedAt !== null)) || (status !== 'new' && (dueAt === null || lastReviewedAt === null)) || (status === 'familiar' && stage < 3)) fail();
  return { wordId: wordId(v.wordId), stage, status, dueAt, lastReviewedAt, reviewCount: integer(v.reviewCount), lapseCount: integer(v.lapseCount), schedulerVersion: integer(v.schedulerVersion, 100), updatedAt: number(v.updatedAt), version: integer(v.version) };
}

export function validateBackup(value: unknown): Backup {
  const v = object(value);
  if (v.schemaVersion !== 1) throw new Error('不支持此备份版本，请使用本网站导出的 JSON。');
  const words = unique(array(v.words, validateWord), w => w.id);
  const personalWords = unique(array(v.personalWords, value => { const p = object(value); return { wordId: wordId(p.wordId), addedAt: number(p.addedAt), note: string(p.note, 20000, true), paused: bool(p.paused), updatedAt: number(p.updatedAt) }; }), p => p.wordId);
  const notebooks = unique(array(v.notebooks, value => { const n = object(value); return { id: string(n.id, 200), name: string(n.name, 80).trim(), createdAt: number(n.createdAt), updatedAt: number(n.updatedAt), isDefault: bool(n.isDefault) }; }, 5000), n => n.id);
  if (notebooks.some(n => n.isDefault !== (n.id === 'all')) || notebooks.filter(n => n.isDefault).length !== 1) fail();
  unique(notebooks, n => normalizedKey(n.name));
  const memberships = unique(array(v.memberships, value => { const m = object(value); return { notebookId: string(m.notebookId, 200), wordId: wordId(m.wordId), addedAt: number(m.addedAt) }; }), m => `${m.notebookId}\0${m.wordId}`);
  const searchEvents = unique(array(v.searchEvents, value => { const e = object(value); return { id: string(e.id, 200), wordId: wordId(e.wordId), searchedAt: number(e.searchedAt) }; }), e => e.id);
  const history = unique(array(v.history, value => { const h = object(value); const firstSearchedAt = number(h.firstSearchedAt), lastSearchedAt = number(h.lastSearchedAt), searchCount = integer(h.searchCount); if (firstSearchedAt > lastSearchedAt || searchCount < 1) fail(); return { wordId: wordId(h.wordId), firstSearchedAt, lastSearchedAt, searchCount }; }), h => h.wordId);
  const progress = unique(array(v.progress, parseProgress), p => p.wordId);
  const reviews = unique(array(v.reviews, value => {
    const e = object(value);
    if (!['flashcard', 'spelling'].includes(e.mode as string) || !['forgot', 'fuzzy', 'remembered'].includes(e.rating as string)) fail();
    const timeZone = string(e.timeZone, 100);
    try { new Intl.DateTimeFormat('en', { timeZone }).format(); } catch { fail(); }
    const studyDate = string(e.studyDate, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(studyDate)) fail();
    const id = wordId(e.wordId);
    const before = parseProgress(e.before), after = parseProgress(e.after);
    if (before.wordId !== id || after.wordId !== id) fail();
    return { id: string(e.id, 500), sessionId: string(e.sessionId, 200), wordId: id, wordSnapshot: string(e.wordSnapshot, 80), mode: e.mode as ReviewEvent['mode'], rating: e.rating as ReviewEvent['rating'], ...(e.correct === undefined ? {} : { correct: bool(e.correct) }), reviewedAt: number(e.reviewedAt), studyDate, timeZone, before, after, planned: bool(e.planned) };
  }), e => e.id);
  const wordIds = new Set(words.map(w => w.id)), personalIds = new Set(personalWords.map(w => w.wordId)), notebookIds = new Set(notebooks.map(n => n.id));
  if (personalWords.some(p => !wordIds.has(p.wordId)) || memberships.some(m => !personalIds.has(m.wordId) || !notebookIds.has(m.notebookId) || m.notebookId === 'all') || progress.some(p => !personalIds.has(p.wordId))) fail();
  // Search/review logs can outlive deleted personal words; review snapshots preserve their meaning.
  return { schemaVersion: 1, exportedAt: number(v.exportedAt), dictionaryVersion: string(v.dictionaryVersion, 200, true), words, personalWords, notebooks, memberships, searchEvents, history, progress, reviews };
}

export function parseBackup(text: string): Backup {
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error('备份超过 20 MiB，无法导入。');
  let value: unknown;
  try { value = JSON.parse(text); } catch { throw new Error('备份不是有效的 JSON 文件。'); }
  return validateBackup(value);
}
