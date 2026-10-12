import type { Notebook, NotebookWord, PersonalWord, Preferences, ReviewEvent, SearchEvent, StudyProgress } from '../src/types';

export const entities = ['personalWords', 'notebooks', 'memberships', 'progress', 'searchEvents', 'reviews', 'preferences'] as const;
export type Entity = typeof entities[number];
export type SyncValue = PersonalWord | Notebook | NotebookWord | StudyProgress | SearchEvent | ReviewEvent | Preferences;
export interface SyncRecord { key: string; entity: Entity; value: SyncValue | null; revision: number }
export interface SyncOperation { id: string; key: string; entity: Entity; value: SyncValue | null; baseRevision: number }
export interface SyncResult { id: string; accepted: boolean; record: SyncRecord }
export const equal = (a: unknown, b: unknown): boolean => stable(a) === stable(b);
export function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
}
export function recordKey(entity: Entity, value: SyncValue): string {
  const v = value as unknown as Record<string, unknown>;
  const id = entity === 'preferences' ? 'main' : entity === 'memberships' ? JSON.stringify([v.notebookId, v.wordId]) : ['personalWords', 'progress'].includes(entity) ? v.wordId : v.id;
  return `${entity}:${id}`;
}
const obj = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('同步记录格式无效。'); return v as Record<string, unknown>; };
const str = (v: unknown, max = 500, empty = false): string => { if (typeof v !== 'string' || v.length > max || (!empty && !v.trim())) throw new Error('同步文本无效。'); return v; };
const num = (v: unknown): number => { if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) throw new Error('同步数值无效。'); return v; };
const boolean = (v: unknown): boolean => { if (typeof v !== 'boolean') throw new Error('同步布尔值无效。'); return v; };
function wordId(v: unknown): string { const id = str(v, 83); const word = id.slice(3); if (!id.startsWith('en:') || !word || word !== word.trim().normalize('NFKC').replace(/[‘’ʼ]/g, "'").toLocaleLowerCase('en-US')) throw new Error('同步单词 ID 无效。'); return id; }
function progress(v: unknown): StudyProgress {
  const p = obj(v); const stage = p.stage;
  if (typeof stage !== 'number' || !Number.isInteger(stage) || stage < -1 || stage > 4 || !['new','learning','familiar'].includes(String(p.status))) throw new Error('同步进度无效。');
  const dueAt = p.dueAt === null ? null : num(p.dueAt), lastReviewedAt = p.lastReviewedAt === null ? null : num(p.lastReviewedAt);
  if (p.status === 'new' ? stage !== -1 || dueAt !== null || lastReviewedAt !== null : dueAt === null || lastReviewedAt === null) throw new Error('同步日程无效。');
  if (p.status === 'familiar' && stage < 3) throw new Error('同步熟悉度无效。');
  return { wordId: wordId(p.wordId), stage, status: p.status as StudyProgress['status'], dueAt, lastReviewedAt, reviewCount:num(p.reviewCount), lapseCount:num(p.lapseCount), schedulerVersion:num(p.schedulerVersion), updatedAt:num(p.updatedAt), version:num(p.version) };
}
export function validateValue(entity: Entity, value: unknown): SyncValue {
  const v = obj(value);
  switch (entity) {
    case 'personalWords': return {wordId:wordId(v.wordId), addedAt:num(v.addedAt), note:str(v.note,20000,true), paused:boolean(v.paused), updatedAt:num(v.updatedAt)};
    case 'notebooks': {
      const id = str(v.id,200), isDefault = boolean(v.isDefault);
      if (isDefault !== (id === 'all')) throw new Error('默认词本格式无效。');
      return {id,name:str(v.name,80),createdAt:num(v.createdAt),updatedAt:num(v.updatedAt),isDefault};
    }
    case 'memberships': { const notebookId = str(v.notebookId,200); if (notebookId === 'all') throw new Error('分类关系无效。'); return {notebookId,wordId:wordId(v.wordId),addedAt:num(v.addedAt)}; }
    case 'progress': return progress(v);
    case 'searchEvents': return {id:str(v.id,200),wordId:wordId(v.wordId),searchedAt:num(v.searchedAt)};
    case 'reviews': {
      if (!['flashcard','spelling'].includes(String(v.mode)) || !['forgot','fuzzy','remembered'].includes(String(v.rating))) throw new Error('复习记录无效。');
      const timeZone = str(v.timeZone,100); new Intl.DateTimeFormat('en',{timeZone}).format();
      const studyDate = str(v.studyDate,10); if (!/^\d{4}-\d{2}-\d{2}$/.test(studyDate)) throw new Error('复习日期无效。');
      const id = wordId(v.wordId), before = progress(v.before), after = progress(v.after);
      if (before.wordId !== id || after.wordId !== id) throw new Error('复习进度关联无效。');
      return {id:str(v.id,500),sessionId:str(v.sessionId,200),wordId:id,wordSnapshot:str(v.wordSnapshot,80),mode:v.mode as ReviewEvent['mode'],rating:v.rating as ReviewEvent['rating'],...(v.correct===undefined?{}:{correct:boolean(v.correct)}),reviewedAt:num(v.reviewedAt),studyDate,timeZone,before,after,planned:boolean(v.planned)};
    }
    case 'preferences': {
      const timeZone = str(v.timeZone,100); new Intl.DateTimeFormat('en',{timeZone}).format();
      const studyLimit = num(v.studyLimit); if (![5,10,15,20].includes(studyLimit)) throw new Error('学习词数无效。');
      return {timeZone,studyLimit,shortcuts:boolean(v.shortcuts)};
    }
  }
}
export function validateRecord(input: unknown): SyncRecord {
  const v = obj(input); if (!entities.includes(v.entity as Entity)) throw new Error('同步类型无效。');
  const entity = v.entity as Entity, key = str(v.key,800), value = v.value === null ? null : validateValue(entity,v.value);
  if (value !== null ? recordKey(entity,value) !== key : !key.startsWith(`${entity}:`) || key.length <= entity.length+1) throw new Error('同步键无效。');
  if (value === null && (key === 'notebooks:all' || entity === 'preferences')) throw new Error('基础设置不能删除。');
  if (value === null) {
    const id=key.slice(entity.length+1);
    if(entity==='personalWords'||entity==='progress')wordId(id);
    else if(entity==='memberships'){
      const pair=JSON.parse(id);if(!Array.isArray(pair)||pair.length!==2)throw new Error('同步关系键无效。');
      if(str(pair[0],200)==='all')throw new Error('同步关系键无效。');wordId(pair[1]);
    }else str(id,entity==='reviews'?500:200);
  }
  return {key,entity,value,revision:num(v.revision)};
}
export function validateOperation(input: unknown): SyncOperation {
  const v = obj(input), record = validateRecord({...v,revision:v.baseRevision});
  return {id:str(v.id,100),key:record.key,entity:record.entity,value:record.value,baseRevision:record.revision};
}

/** Three-way merge only rebases local fields actually edited since the known cloud value. */
export function mergeValue(entity: Entity, base: SyncValue | null, local: SyncValue | null, remote: SyncValue | null): SyncValue | null {
  // A concurrent delete takes precedence. Re-adding after observing the tombstone is a new operation.
  if (local === null || remote === null) return null;
  if (equal(local,remote)) return remote;
  if (entity === 'searchEvents' || entity === 'reviews') {
    if (!equal(local,remote)) throw new Error('同一学习事件出现不同内容，请导出备份后检查。');
    return remote;
  }
  const l = local as unknown as Record<string,unknown>, r = remote as unknown as Record<string,unknown>, b = (base ?? {}) as unknown as Record<string,unknown>;
  if (entity === 'progress') {
    const winner = Number(l.updatedAt) > Number(r.updatedAt) || (l.updatedAt === r.updatedAt && stable(l) > stable(r)) ? l : r;
    return validateValue(entity,{...winner,reviewCount:Math.max(Number(l.reviewCount),Number(r.reviewCount)),lapseCount:Math.max(Number(l.lapseCount),Number(r.lapseCount)),version:Math.max(Number(l.version),Number(r.version))});
  }
  if (entity === 'notebooks' && l.id === 'all') return remote;
  const result = {...r};
  for (const [field,value] of Object.entries(l)) if (!equal(value,b[field])) result[field] = value;
  if (entity === 'personalWords') {
    if (!equal(l.note,b.note) && !equal(r.note,b.note) && l.note !== r.note) {
      const notes = [String(r.note),String(l.note)].filter(Boolean);
      result.note = notes.length === 2 && !notes[0].includes(notes[1]) && !notes[1].includes(notes[0]) ? notes.join('\n\n[同步冲突笔记]\n') : notes.sort((a,b)=>b.length-a.length)[0] ?? '';
      if (String(result.note).length > 20000) throw new Error('冲突笔记合并后过长，待同步内容已保留，请缩短笔记后重试。');
    }
    result.addedAt = Math.min(Number(l.addedAt),Number(r.addedAt));
  }
  if ('updatedAt' in result) result.updatedAt = Math.max(Number(l.updatedAt),Number(r.updatedAt));
  return validateValue(entity,result);
}
