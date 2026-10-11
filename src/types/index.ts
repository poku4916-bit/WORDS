export interface ChineseGloss { pos?: string; text: string; source: string }
export interface EnglishSense { id: string; pos: string; definition: string; synonyms: string[]; examples: string[]; source: string }
export interface WordEntry { id: string; word: string; normalizedWord: string; phonetics: string[]; chineseGlosses: ChineseGloss[]; englishSenses: EnglishSense[]; sources: string[]; dataVersion: string; contentStatus: { chinese: boolean; english: boolean } }
export type Rating = 'forgot' | 'fuzzy' | 'remembered';
export type StudyMode = 'flashcard' | 'spelling';
export interface PersonalWord { wordId: string; addedAt: number; note: string; paused: boolean; updatedAt: number }
export interface Notebook { id: string; name: string; createdAt: number; updatedAt: number; isDefault: boolean }
export interface NotebookWord { notebookId: string; wordId: string; addedAt: number }
export interface SearchEvent { id: string; wordId: string; searchedAt: number }
export interface SearchHistory { wordId: string; firstSearchedAt: number; lastSearchedAt: number; searchCount: number }
export interface StudyProgress { wordId: string; stage: number; status: 'new' | 'learning' | 'familiar'; dueAt: number | null; lastReviewedAt: number | null; reviewCount: number; lapseCount: number; schedulerVersion: number; updatedAt: number; version: number }
export interface ReviewEvent { id: string; sessionId: string; wordId: string; wordSnapshot: string; mode: StudyMode; rating: Rating; correct?: boolean; reviewedAt: number; studyDate: string; timeZone: string; before: StudyProgress; after: StudyProgress; planned: boolean }
export interface StudySession { id: string; notebookIds: string[]; mode: StudyMode; practice: boolean; queue: string[]; cursor: number; retryQueue: string[]; submittedEventIds: string[]; startedAt: number; finishedAt?: number; reverse: boolean }
export interface Snapshot { words: WordEntry[]; personalWords: PersonalWord[]; notebooks: Notebook[]; memberships: NotebookWord[]; history: SearchHistory[]; progress: StudyProgress[]; reviews: ReviewEvent[]; session?: StudySession }
export interface Preferences { timeZone: string; studyLimit: number; shortcuts: boolean }
