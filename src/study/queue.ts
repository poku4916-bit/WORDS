import type { Snapshot, StudyMode, WordEntry } from '../types';
import { DEFAULT_NOTEBOOK_ID } from '../storage/database';

export function isSpellingEligible(word: WordEntry): boolean {
  if (!word.chineseGlosses.some(g => /[\u3400-\u9fff]/u.test(g.text)) || !word.englishSenses.some(s => s.definition.trim())) return false;
  const chinese = word.chineseGlosses.map(g => g.text).join(';');
  const english = word.englishSenses.map(s => s.definition).join(';');
  return !/(?:人名|地名|姓氏|男子名|女子名|男性名|女性名|音译|专有名词)/u.test(chinese) && !/\b(?:given name|surname|proper name|family name)\b/i.test(english);
}

export function buildQueue(snapshot: Snapshot, notebookIds: string[], mode: StudyMode, limit: number, practice: boolean, now: number): string[] {
  const selected = new Set(notebookIds.includes(DEFAULT_NOTEBOOK_ID) ? snapshot.personalWords.map(p => p.wordId) : snapshot.memberships.filter(m => notebookIds.includes(m.notebookId)).map(m => m.wordId));
  const words = new Map(snapshot.words.map(w => [w.id, w]));
  const progress = new Map(snapshot.progress.map(p => [p.wordId, p]));
  const candidates = snapshot.personalWords.filter(p => selected.has(p.wordId) && !p.paused && words.has(p.wordId) && (mode !== 'spelling' || isSpellingEligible(words.get(p.wordId)!)));
  if (practice) return candidates.sort((a, b) => a.addedAt - b.addedAt || a.wordId.localeCompare(b.wordId)).slice(0, limit).map(p => p.wordId);
  const due = candidates.filter(p => { const status = progress.get(p.wordId); return status?.dueAt != null && status.dueAt <= now; }).sort((a, b) => (progress.get(a.wordId)!.dueAt! - progress.get(b.wordId)!.dueAt!) || a.wordId.localeCompare(b.wordId));
  const fresh = candidates.filter(p => !progress.get(p.wordId) || progress.get(p.wordId)?.status === 'new').sort((a, b) => a.addedAt - b.addedAt || a.wordId.localeCompare(b.wordId));
  return [...due.slice(0, limit), ...fresh.slice(0, Math.min(10, Math.max(0, limit - due.length)))].map(p => p.wordId);
}
