import type { Snapshot, WordEntry } from './types';
export const gloss = (word?: WordEntry) => word?.chineseGlosses.map(g => g.text).join('；') || '暂无中文释义';
export const dateLabel = (time: number | null | undefined, timeZone = 'Asia/Shanghai') => time ? new Intl.DateTimeFormat('zh-CN', { timeZone, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(time) : '尚未学习';
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试。';
export const statusLabel = (snapshot: Snapshot, id: string) => snapshot.personalWords.find(w => w.wordId === id)?.paused ? '已暂停' : ({ new: '新词', learning: '学习中', familiar: '已熟悉' })[snapshot.progress.find(p => p.wordId === id)?.status || 'new'];
export const notebookWordIds = (snapshot: Snapshot, notebookId: string) => notebookId === 'all' ? snapshot.personalWords.map(p => p.wordId) : snapshot.memberships.filter(m => m.notebookId === notebookId).map(m => m.wordId);
