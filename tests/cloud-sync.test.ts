import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { hash, type Env } from '../worker';
import { WordsDatabase, initialProgress } from '../src/storage/database';
import { SyncEngine, type SyncTransport } from '../src/sync/engine';
import { scheduleReview } from '../src/study/scheduler';
import type { Preferences, WordEntry } from '../src/types';
import { mergeValue, validateOperation, type SyncOperation, type SyncValue } from '../shared/sync';

class Statement {
  constructor(private sql:DatabaseSync,private query:string,private values:(string|number|null)[]=[]){ }
  bind(...values:(string|number|null)[]){return new Statement(this.sql,this.query,values);}
  async first(){return this.sql.prepare(this.query).get(...this.values)??null;}
  async all(){return {results:this.sql.prepare(this.query).all(...this.values),success:true};}
  async run(){const meta=this.sql.prepare(this.query).run(...this.values);return {results:[],success:true,meta};}
}
let sql:DatabaseSync,env:Env,token:string;
const databases:WordsDatabase[]=[];
const word=(name='bank'):WordEntry=>({id:`en:${name}`,word:name,normalizedWord:name,phonetics:[],chineseGlosses:[{text:'释义',source:'ECDICT'}],englishSenses:[],sources:['ECDICT'],dataVersion:'test',contentStatus:{chinese:true,english:false}});
async function call(path:string,body?:unknown,authenticated=true,origin='https://words.test'){
  const headers:Record<string,string>={};if(authenticated)headers.Cookie=`words_session=${token}`;
  if(body!==undefined){headers['Content-Type']='application/json';headers.Origin=origin;}
  return worker.fetch(new Request(`https://words.test${path}`,{method:body===undefined?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body)}),env);
}
const transport:SyncTransport={pull:async(after,until)=>{const r=await call(`/api/sync?after=${after}${until===undefined?'':`&until=${until}`}`);if(!r.ok)throw new Error(await r.text());return r.json();},push:async operations=>{const r=await call('/api/sync',{operations});if(!r.ok)throw new Error(await r.text());return r.json();}};
async function device(prefs:Preferences|null=null,custom:SyncTransport=transport){
  const database=new WordsDatabase(`test-device-${crypto.randomUUID()}`);databases.push(database);await database.open();
  await database.notebooks.put({id:'all',name:'我的单词',isDefault:true,createdAt:Date.now(),updatedAt:Date.now()});
  let preferences=prefs;
  const engine=new SyncEngine({database,transport:custom,getPreferences:()=>preferences,setPreferences:p=>{preferences=p;},lookup:async name=>word(name)});
  return {database,engine,prefs:()=>preferences,setPrefs:(p:Preferences)=>{preferences=p;}};
}
async function add(database:WordsDatabase){const now=Date.now();await database.words.put(word());await database.personalWords.put({wordId:'en:bank',addedAt:now,note:'initial',paused:false,updatedAt:now});await database.progress.put(initialProgress('en:bank',now));}
beforeEach(async()=>{
  sql=new DatabaseSync(':memory:');sql.exec(readFileSync(new URL('../worker/migrations/0001_sync.sql',import.meta.url),'utf8'));
  const db={prepare:(query:string)=>new Statement(sql,query),batch:async(statements:Statement[])=>{sql.exec('BEGIN');try{const results=[];for(const statement of statements)results.push(await statement.all());sql.exec('COMMIT');return results;}catch(error){sql.exec('ROLLBACK');throw error;}}};
  env={DB:db as unknown as Env['DB'],ASSETS:{fetch:async()=>new Response('static')} as unknown as Env['ASSETS'],GITHUB_CLIENT_ID:'test-client',GITHUB_CLIENT_SECRET:'test-secret',ALLOWED_GITHUB_ID:'266625893'};
  token='a'.repeat(64);sql.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(await hash(token),'266625893','poku4916-bit',Date.now()+60000);
});
afterEach(async()=>{vi.unstubAllGlobals();for(const database of databases.splice(0))await database.delete();sql.close();});

describe('private Worker API',()=>{
  it('rejects anonymous access, cross-origin writes and sessions for another account',async()=>{
    expect((await call('/api/sync',undefined,false)).status).toBe(401);
    expect((await call('/api/sync',{operations:[]},true,'https://evil.test')).status).toBe(403);
    sql.prepare('UPDATE sessions SET github_id=?').run('someone-else');
    expect((await call('/api/sync')).status).toBe(401);
  });
  it('rejects malformed records and invalid state before contacting GitHub',async()=>{
    expect((await call('/api/sync',{operations:[{id:'bad',key:'personalWords:en:x',entity:'personalWords',value:{note:'x'},baseRevision:0}]})).status).toBe(400);
    const mock=vi.fn();vi.stubGlobal('fetch',mock);
    expect((await call('/api/auth/callback?state=bad&code=bad')).headers.get('Location')).toContain('invalid_state');
    expect(mock).not.toHaveBeenCalled();
  });
  it('creates a hashed session only for the configured GitHub account',async()=>{
    const state='b'.repeat(64);const request=()=>new Request(`https://words.test/api/auth/callback?state=${state}&code=valid`,{headers:{Cookie:`words_oauth=${state}`}});
    const mock=vi.fn().mockResolvedValueOnce(Response.json({access_token:'temporary'})).mockResolvedValueOnce(Response.json({id:1,login:'other'}));vi.stubGlobal('fetch',mock);
    expect((await worker.fetch(request(),env)).headers.get('Location')).toContain('not_allowed');
    mock.mockResolvedValueOnce(Response.json({access_token:'temporary'})).mockResolvedValueOnce(Response.json({id:266625893,login:'poku4916-bit'}));
    const response=await worker.fetch(request(),env), cookies=response.headers.get('Set-Cookie')!;
    expect(response.status).toBe(302);expect(cookies).toContain('HttpOnly');expect(cookies).toContain('Secure');expect(cookies).not.toContain('temporary');
    expect(sql.prepare('SELECT COUNT(*) AS count FROM sessions').get()!.count).toBe(2);
  });
  it('applies retries once and prevents stale requests or old retries from rolling back data',async()=>{
    const operation:SyncOperation={id:'op1',key:'notebooks:book',entity:'notebooks',value:{id:'book',name:'First',isDefault:false,createdAt:1,updatedAt:1},baseRevision:0};
    const first=await (await call('/api/sync',{operations:[operation]})).json() as {results:{record:{revision:number}}[]};
    const revision=first.results[0].record.revision;
    const next={...operation,id:'op2',baseRevision:revision,value:{...operation.value,name:'Second',updatedAt:2}};
    await call('/api/sync',{operations:[next]});
    const retry=await (await call('/api/sync',{operations:[operation]})).json() as {results:{accepted:boolean;record:{value:{name:string}}}[]};
    expect(retry.results[0].accepted).toBe(true);expect(retry.results[0].record.value.name).toBe('Second');
    const stale=await (await call('/api/sync',{operations:[{...next,id:'stale',value:operation.value}]})).json() as {results:{accepted:boolean}[]};
    expect(stale.results[0].accepted).toBe(false);
    expect(sql.prepare('SELECT COUNT(*) AS count FROM sync_changes').get()!.count).toBe(2);
  });
  it('invalidates the server session on logout',async()=>{expect((await call('/api/auth/logout',{})).status).toBe(200);expect((await call('/api/sync')).status).toBe(401);});
});

describe('two devices against the same SQL-backed cloud API',()=>{
  it('automatically transfers vocabulary, definitions, categories and preferences',async()=>{
    const a=await device({timeZone:'Asia/Shanghai',studyLimit:10,shortcuts:false}),b=await device();await add(a.database);
    await a.database.notebooks.put({id:'finance',name:'金融',createdAt:1,updatedAt:1,isDefault:false});
    await a.database.memberships.put({notebookId:'finance',wordId:'en:bank',addedAt:1});
    await a.engine.sync();await b.engine.sync();
    expect(await b.database.personalWords.get('en:bank')).toMatchObject({note:'initial'});
    expect(await b.database.words.get('en:bank')).toMatchObject({word:'bank'});
    expect(await b.database.memberships.count()).toBe(1);expect(b.prefs()).toEqual(a.prefs());
    expect(await b.database.searchEvents.count()).toBe(0);expect(await b.database.syncQueue.count()).toBe(0);
  });
  it('preserves concurrent notes and independent fields from both devices',async()=>{
    const a=await device(),b=await device();await add(a.database);await a.engine.sync();await b.engine.sync();
    await a.database.personalWords.update('en:bank',{note:'computer note',updatedAt:100});
    await b.database.personalWords.update('en:bank',{note:'phone note',paused:true,updatedAt:200});
    await a.engine.sync();await b.engine.sync();await a.engine.sync();
    const value=await a.database.personalWords.get('en:bank');expect(value!.note).toContain('computer note');expect(value!.note).toContain('phone note');expect(value!.paused).toBe(true);
    expect(await b.database.personalWords.get('en:bank')).toEqual(value);
  });
  it('does not resurrect a deleted word or its relations from an offline device',async()=>{
    const a=await device(),b=await device();await add(a.database);await a.engine.sync();await b.engine.sync();
    await b.database.personalWords.update('en:bank',{note:'offline edit',updatedAt:Date.now()+1000});
    await a.database.personalWords.delete('en:bank');await a.database.progress.delete('en:bank');await a.engine.sync();await b.engine.sync();
    expect(await b.database.personalWords.count()).toBe(0);expect(await b.database.progress.count()).toBe(0);expect(await b.database.syncQueue.count()).toBe(0);
    await add(b.database);await b.engine.sync();await a.engine.sync();expect(await a.database.personalWords.count()).toBe(1);
  });
  it('keeps durable changes after a lost acknowledgement and a new engine instance',async()=>{
    let lose=true;
    const flaky:SyncTransport={...transport,push:async operations=>{const result=await transport.push(operations);if(lose){lose=false;throw new Error('lost connection');}return result;}};
    const a=await device(null,flaky);await add(a.database);await expect(a.engine.sync()).rejects.toThrow('lost connection');expect(await a.database.syncQueue.count()).toBeGreaterThan(0);
    const restarted=new SyncEngine({database:a.database,transport,getPreferences:()=>null,setPreferences:()=>{},lookup:async name=>word(name)});await restarted.sync();
    expect(await a.database.syncQueue.count()).toBe(0);const b=await device();await b.engine.sync();expect(await b.database.personalWords.count()).toBe(1);
  });
  it('captures edits made while an earlier version is being uploaded',async()=>{
    let changed=false;const a=await device();await add(a.database);await a.engine.sync();
    const delayed:SyncTransport={...transport,push:async operations=>{const response=await transport.push(operations);if(!changed&&operations.some(op=>op.entity==='personalWords')){changed=true;await a.database.personalWords.update('en:bank',{note:'typed during upload',updatedAt:Date.now()+1000});}return response;}};
    await a.database.personalWords.update('en:bank',{note:'first edit',updatedAt:Date.now()});
    await new SyncEngine({database:a.database,transport:delayed,getPreferences:()=>null,setPreferences:()=>{},lookup:async name=>word(name)}).sync();
    const b=await device();await b.engine.sync();expect((await b.database.personalWords.get('en:bank'))!.note).toBe('typed during upload');
  });
  it('recomputes query history from unique events and synchronizes clearing history',async()=>{
    const a=await device(),b=await device();await add(a.database);await a.database.searchEvents.put({id:'query',wordId:'en:bank',searchedAt:1});await a.engine.sync();await b.engine.sync();
    expect((await b.database.history.get('en:bank'))!.searchCount).toBe(1);
    await a.database.searchEvents.clear();await a.engine.sync();await b.engine.sync();expect(await b.database.history.count()).toBe(0);
  });
  it('paginates more than 100 records without skipping them',async()=>{
    const a=await device(),b=await device();for(let i=0;i<115;i++)await a.database.searchEvents.put({id:`query-${i}`,wordId:'en:bank',searchedAt:i});await a.engine.sync();await b.engine.sync();expect(await b.database.searchEvents.count()).toBe(115);
  });
  it('preserves both concurrent review events and their aggregate counters',async()=>{
    const a=await device(),b=await device();await add(a.database);await a.engine.sync();await b.engine.sync();
    for(const [device,id,time] of [[a,'computer',1000],[b,'phone',2000]] as const){
      const before=(await device.database.progress.get('en:bank'))!,after=scheduleReview(before,'remembered',time,'Asia/Shanghai');
      await device.database.progress.put(after);
      await device.database.reviews.put({id,sessionId:id,wordId:'en:bank',wordSnapshot:'bank',mode:'flashcard',rating:'remembered',reviewedAt:time,studyDate:'1970-01-01',timeZone:'Asia/Shanghai',before,after,planned:true});
    }
    await a.engine.sync();await b.engine.sync();await a.engine.sync();
    expect(await a.database.reviews.count()).toBe(2);expect(await b.database.reviews.count()).toBe(2);
    expect(await a.database.progress.get('en:bank')).toMatchObject({reviewCount:2,lastReviewedAt:2000});
    expect(await b.database.progress.get('en:bank')).toEqual(await a.database.progress.get('en:bank'));
  });
  it('keeps a newer cloud schedule when an older offline assessment arrives',async()=>{
    const a=await device(),b=await device();await add(a.database);await a.engine.sync();await b.engine.sync();
    const before=(await a.database.progress.get('en:bank'))!;
    await a.database.progress.put(scheduleReview(before,'remembered',2000));
    await b.database.progress.put(scheduleReview(before,'forgot',1000));
    await a.engine.sync();await b.engine.sync();await a.engine.sync();
    expect(await a.database.progress.get('en:bank')).toMatchObject({lastReviewedAt:2000,status:'learning',reviewCount:1,lapseCount:1});
  });
});

it('upgrades the original local database without losing existing words or notes',async()=>{
  const name=`migration-${crypto.randomUUID()}`,old=new Dexie(name);
  old.version(1).stores({words:'id, &normalizedWord',personalWords:'wordId, addedAt, updatedAt',notebooks:'id, name, createdAt',memberships:'[notebookId+wordId], notebookId, wordId',searchEvents:'id, wordId, searchedAt',history:'wordId, lastSearchedAt',progress:'wordId, dueAt, status',reviews:'id, sessionId, wordId, reviewedAt, studyDate',sessions:'id, startedAt'});
  await old.open();await old.table('words').put(word());await old.table('personalWords').put({wordId:'en:bank',addedAt:1,updatedAt:1,note:'before upgrade',paused:false});old.close();
  const upgraded=new WordsDatabase(name);databases.push(upgraded);await upgraded.open();
  expect((await upgraded.personalWords.get('en:bank'))!.note).toBe('before upgrade');expect(await upgraded.words.count()).toBe(1);expect(await upgraded.syncQueue.count()).toBe(0);
});

it('validates keys and merges progress counters without rolling schedules back',()=>{
  expect(()=>validateOperation({id:'x',key:'progress:en:other',entity:'progress',value:initialProgress('en:bank'),baseRevision:0})).toThrow();
  const base=initialProgress('en:bank',1),local={...base,reviewCount:2,updatedAt:10},remote={...base,reviewCount:1,updatedAt:20};
  expect(mergeValue('progress',base as SyncValue,local,remote)).toMatchObject({reviewCount:2,updatedAt:20});
});
