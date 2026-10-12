import Dexie, { type Table } from 'dexie';
import type { Notebook, NotebookWord, PersonalWord, ReviewEvent, SearchEvent, SearchHistory, StudyProgress, StudySession, WordEntry } from '../types';
import type { SyncOperation, SyncRecord } from '../../shared/sync';

export const DEFAULT_NOTEBOOK_ID = 'all';

export class WordsDatabase extends Dexie {
  words!: Table<WordEntry, string>;
  personalWords!: Table<PersonalWord, string>;
  notebooks!: Table<Notebook, string>;
  memberships!: Table<NotebookWord, [string, string]>;
  searchEvents!: Table<SearchEvent, string>;
  history!: Table<SearchHistory, string>;
  progress!: Table<StudyProgress, string>;
  reviews!: Table<ReviewEvent, string>;
  sessions!: Table<StudySession, string>;
  syncHeads!: Table<SyncRecord, string>;
  syncQueue!: Table<SyncOperation, string>;
  syncMeta!: Table<{ key: string; value: unknown }, string>;

  constructor(name = 'words-notebook') {
    super(name);
    this.version(1).stores({
      words: 'id, &normalizedWord',
      personalWords: 'wordId, addedAt, updatedAt',
      notebooks: 'id, name, createdAt',
      memberships: '[notebookId+wordId], notebookId, wordId',
      searchEvents: 'id, wordId, searchedAt',
      history: 'wordId, lastSearchedAt',
      progress: 'wordId, dueAt, status',
      reviews: 'id, sessionId, wordId, reviewedAt, studyDate',
      sessions: 'id, startedAt',
    });
    this.version(2).stores({ syncHeads: 'key, entity', syncQueue: 'key', syncMeta: 'key' });
  }
}

export const db = new WordsDatabase();

export function initialProgress(wordId: string, now = Date.now()): StudyProgress {
  return { wordId, stage: -1, status: 'new', dueAt: null, lastReviewedAt: null, reviewCount: 0, lapseCount: 0, schedulerVersion: 1, updatedAt: now, version: 0 };
}

export function newId(prefix: string): string {
  return `${prefix}:${crypto.randomUUID()}`;
}

export function normalizedKey(value: string): string {
  return value.trim().normalize('NFKC').replace(/[‘’ʼ]/g, "'").toLocaleLowerCase('en-US');
}
