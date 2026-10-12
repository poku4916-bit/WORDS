import type { Table } from 'dexie';
import { WordsDatabase, initialProgress } from '../storage/database';
import { equal, mergeValue, recordKey, validateRecord, validateValue, type Entity, type SyncOperation, type SyncRecord, type SyncResult, type SyncValue } from '../../shared/sync';
import type { Preferences, ReviewEvent, SearchHistory, StudyProgress, WordEntry } from '../types';

export interface SyncTransport {
  pull(after: number, until?: number): Promise<{ records: SyncRecord[]; next: number; until: number; more: boolean }>;
  push(operations: SyncOperation[]): Promise<{ results: SyncResult[] }>;
}
export interface SyncOptions {
  database: WordsDatabase;
  transport: SyncTransport;
  getPreferences: () => Preferences | null;
  setPreferences: (preferences: Preferences) => void;
  lookup: (word: string) => Promise<WordEntry>;
}
const syncedEntities: Entity[] = ['personalWords','notebooks','memberships','progress','searchEvents','reviews'];
export class SyncEngine {
  private readonly db: WordsDatabase;
  constructor(private readonly options: SyncOptions) { this.db=options.database; }
  private table(entity: Entity): Table { return this.db.table(entity); }
  private tables() { return [...syncedEntities.map(e=>this.table(e)),this.db.words,this.db.history,this.db.sessions,this.db.syncHeads,this.db.syncQueue,this.db.syncMeta]; }
  private id(record: Pick<SyncRecord,'key'|'entity'>): string | [string,string] {
    const id=record.key.slice(record.entity.length+1);
    if(record.entity==='memberships'){ const pair=JSON.parse(id); if(!Array.isArray(pair)||pair.length!==2||pair.some(v=>typeof v!=='string'))throw new Error('同步分类 ID 无效。'); return pair as [string,string]; }
    return id;
  }
  private async current(record: Pick<SyncRecord,'key'|'entity'>): Promise<SyncValue|null> {
    if(record.entity==='preferences')return this.options.getPreferences();
    return await this.table(record.entity).get(this.id(record)) ?? null;
  }
  private async put(record: SyncRecord,value: SyncValue|null): Promise<void> {
    if(record.entity==='preferences'){ if(value)this.options.setPreferences(value as Preferences); return; }
    if(value===null) await this.table(record.entity).delete(this.id(record));
    else await this.table(record.entity).put(value);
  }
  private operation(record: Pick<SyncRecord,'key'|'entity'>,value: SyncValue|null,baseRevision: number): SyncOperation { return {id:crypto.randomUUID(),key:record.key,entity:record.entity,value,baseRevision}; }

  /** Comparing against durable cloud heads recovers edits even after a tab crashes before uploading. */
  async capture(): Promise<void> {
    await this.db.transaction('rw',this.tables(),async()=>{
      const records=new Map<string,{key:string;entity:Entity;value:SyncValue|null}>();
      for(const entity of syncedEntities)for(const value of await this.table(entity).toArray() as SyncValue[]) records.set(recordKey(entity,value),{key:recordKey(entity,value),entity,value});
      const prefs=this.options.getPreferences(); if(prefs)records.set('preferences:main',{key:'preferences:main',entity:'preferences',value:prefs});
      const heads=await this.db.syncHeads.toArray(), byKey=new Map(heads.map(r=>[r.key,r]));
      for(const head of heads)if(!records.has(head.key))records.set(head.key,{key:head.key,entity:head.entity,value:head.entity==='preferences'?head.value:null});
      for(const record of records.values()) {
        const head=byKey.get(record.key), previous=await this.db.syncQueue.get(record.key);
        if(equal(record.value,head?.value??null)){ if(previous)await this.db.syncQueue.delete(record.key); }
        else if(!previous||!equal(previous.value,record.value)||previous.baseRevision!==(head?.revision??0)) await this.db.syncQueue.put(this.operation(record,record.value,head?.revision??0));
      }
    });
  }

  private async receive(records: SyncRecord[], results: SyncResult[] = [], sent: SyncOperation[] = []): Promise<void> {
    const valid=records.map(validateRecord), acknowledgements=new Map(results.filter(r=>r.accepted).map(r=>[r.record.key,sent.find(op=>op.id===r.id)!]));
    // Dictionary definitions remain static resources. Hydrate newly synced words without generating search events.
    const definitions:WordEntry[]=[];
    for(const record of valid)if(record.entity==='personalWords'&&record.value!==null){
      const id=(record.value as {wordId:string}).wordId;
      if(!await this.db.words.get(id))definitions.push(await this.options.lookup(id.slice(3)));
    }
    await this.db.transaction('rw',this.tables(),async()=>{
      if(definitions.length)await this.db.words.bulkPut(definitions);
      for(const record of valid) {
        const head=await this.db.syncHeads.get(record.key);
        if(head&&record.revision<=head.revision)continue;
        let desired=await this.current(record), pending=await this.db.syncQueue.get(record.key);
        const acknowledgement=acknowledgements.get(record.key);
        let base=head?.value??null;
        if(acknowledgement){
          base=acknowledgement.value;
          if(equal(desired,acknowledgement.value)) { pending=undefined; await this.db.syncQueue.delete(record.key); }
          else pending=this.operation(record,desired,record.revision);
        } else if(!equal(desired,head?.value??null) && !(record.entity==='preferences'&&desired===null)) {
          pending=pending&&equal(pending.value,desired)?pending:this.operation(record,desired,head?.revision??0);
        }
        if(pending)desired=mergeValue(record.entity,base,desired,record.value);
        else desired=record.value;
        await this.put(record,desired);
        await this.db.syncHeads.put(record);
        if(!equal(desired,record.value))await this.db.syncQueue.put(this.operation(record,desired,record.revision));
        else await this.db.syncQueue.delete(record.key);
      }
    });
  }

  private async pull(): Promise<void> {
    let cursor=Number((await this.db.syncMeta.get('cursor'))?.value??0), until:number|undefined;
    for(let page=0;page<10000;page++) {
      const response=await this.options.transport.pull(cursor,until);
      if(!Number.isSafeInteger(response.next)||response.next<cursor||!Number.isSafeInteger(response.until)||response.until<response.next||response.records.some(r=>r.revision<=cursor||r.revision>response.next))throw new Error('云端同步游标异常。');
      await this.receive(response.records);
      cursor=response.next; until=response.until;
      await this.db.syncMeta.put({key:'cursor',value:cursor});
      if(!response.more)return;
      if(!response.records.length)throw new Error('云端同步分页异常。');
    }
    throw new Error('同步数据过多，请稍后继续。');
  }

  private async reconcile(): Promise<void> {
    await this.db.transaction('rw',this.tables(),async()=>{
      const personal=await this.db.personalWords.toArray(), ids=new Set(personal.map(w=>w.wordId)), notebookIds=new Set((await this.db.notebooks.toArray()).map(n=>n.id));
      for(const p of await this.db.progress.toArray())if(!ids.has(p.wordId))await this.db.progress.delete(p.wordId);
      for(const m of await this.db.memberships.toArray())if(!ids.has(m.wordId)||!notebookIds.has(m.notebookId))await this.db.memberships.delete([m.notebookId,m.wordId]);
      const history=new Map<string,SearchHistory>();
      for(const event of await this.db.searchEvents.toArray()) {
        const old=history.get(event.wordId);
        history.set(event.wordId,{wordId:event.wordId,firstSearchedAt:Math.min(old?.firstSearchedAt??event.searchedAt,event.searchedAt),lastSearchedAt:Math.max(old?.lastSearchedAt??event.searchedAt,event.searchedAt),searchCount:(old?.searchCount??0)+1});
      }
      await this.db.history.clear(); await this.db.history.bulkPut([...history.values()]);
      const reviews=await this.db.reviews.toArray(), counts=new Map<string,{count:number;lapses:number}>();
      for(const event of reviews.filter(e=>e.planned)) { const count=counts.get(event.wordId)??{count:0,lapses:0}; count.count++; if(event.rating==='forgot')count.lapses++; counts.set(event.wordId,count); }
      for(const word of personal) {
        const progress=await this.db.progress.get(word.wordId)??initialProgress(word.wordId,word.addedAt), count=counts.get(word.wordId);
        // Schedules use the latest assessment; counters include all distinct concurrent assessments.
        const updated:StudyProgress={...progress,reviewCount:Math.max(progress.reviewCount,count?.count??0),lapseCount:Math.max(progress.lapseCount,count?.lapses??0)};
        if(!equal(progress,updated)||!await this.db.progress.get(word.wordId))await this.db.progress.put(updated);
      }
      // Removing or pausing a word on another device also removes its unreviewed cards here.
      const active=new Set(personal.filter(p=>!p.paused).map(p=>p.wordId));
      for(const session of (await this.db.sessions.toArray()).filter(s=>s.finishedAt===undefined)) {
        const length=session.queue.length;
        session.queue=session.queue.filter((id,i)=>active.has(id)||i<session.cursor);
        session.retryQueue=session.retryQueue.filter((id,i)=>active.has(id)||length+i<session.cursor);
        if(session.cursor>=session.queue.length+session.retryQueue.length)session.finishedAt=Date.now();
        await this.db.sessions.put(session);
      }
    });
  }

  async sync(): Promise<void> {
    await this.capture(); await this.pull(); await this.reconcile();
    for(let pass=0;pass<3;pass++) {
      await this.capture();
      for(let batch=0;batch<1000;batch++) {
        const queued=(await this.db.syncQueue.toArray()).slice(0,10); if(!queued.length)break;
        // Keep individual batches under the server's byte limit as well as its D1 query limit.
        while(new TextEncoder().encode(JSON.stringify({operations:queued})).length>240*1024 && queued.length>1)queued.pop();
        const response=await this.options.transport.push(queued);
        if(response.results.length!==queued.length||response.results.some(r=>!queued.some(op=>op.id===r.id&&op.key===r.record.key)))throw new Error('云端同步确认异常，待传操作已保留。');
        await this.receive(response.results.map(r=>r.record),response.results,queued);
      }
      await this.pull(); await this.reconcile(); await this.capture();
      if(await this.db.syncQueue.count()===0)return;
    }
    throw new Error('还有变更待同步，将在下一次联网时继续。');
  }
}

export function parsePreference(value: unknown): Preferences { return validateValue('preferences',value) as Preferences; }
export type { ReviewEvent };
