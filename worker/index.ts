/// <reference types="@cloudflare/workers-types" />
import { validateOperation, type Entity, type SyncRecord, type SyncResult } from '../shared/sync';

export interface Env { DB: D1Database; ASSETS: Fetcher; GITHUB_CLIENT_ID?: string; GITHUB_CLIENT_SECRET?: string; ALLOWED_GITHUB_ID?: string }
interface Row { record_key: string; entity: Entity; value: string | null; revision: number; accepted?: number }
const sessionCookie = 'words_session', oauthCookie = 'words_oauth';
const sessionLife = 30 * 86400;
const json = (value: unknown, status = 200): Response => Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});
const configured = (env: Env): boolean => !!(env.DB && env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET && /^\d+$/.test(env.ALLOWED_GITHUB_ID ?? ''));
function cookies(request: Request): Map<string,string> { return new Map((request.headers.get('Cookie') ?? '').split(';').map(part=>part.trim().split(/=(.*)/s).slice(0,2)).filter(p=>p.length===2) as [string,string][]); }
function cookie(request: Request, name: string, value: string, age: number): string { return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(request.url).protocol==='https:'?'; Secure':''}`; }
const random = (): string => Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
export async function hash(value: string): Promise<string> { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join(''); }
function same(a: string,b: string): boolean { if (a.length!==b.length) return false; let diff=0; for(let i=0;i<a.length;i++) diff|=a.charCodeAt(i)^b.charCodeAt(i); return diff===0; }
function redirect(request: Request, path: string, setCookie?: string): Response { const headers = new Headers({'Location':new URL(path,request.url).toString(),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}); if(setCookie)headers.set('Set-Cookie',setCookie); return new Response(null,{status:302,headers}); }
async function user(request: Request,env: Env): Promise<{id:string;login:string} | null> {
  const token = cookies(request).get(sessionCookie); if(!token || !/^[a-f0-9]{64}$/.test(token))return null;
  const row = await env.DB.prepare('SELECT github_id, login FROM sessions WHERE token_hash = ? AND expires_at > ?').bind(await hash(token),Date.now()).first<{github_id:string;login:string}>();
  return row && row.github_id === env.ALLOWED_GITHUB_ID ? {id:row.github_id,login:row.login} : null;
}
const toRecord = (row: Row): SyncRecord => ({key:row.record_key,entity:row.entity,value:row.value===null?null:JSON.parse(row.value),revision:row.revision});

async function readJson(request: Request): Promise<unknown> {
  if(!request.headers.get('Content-Type')?.startsWith('application/json')) throw new Error('请求需使用 JSON。');
  const reader = request.body?.getReader(); if(!reader)throw new Error('请求内容为空。');
  let bytes=0; const parts:Uint8Array[]=[];
  try { while(true){ const part=await reader.read(); if(part.done)break; bytes+=part.value.byteLength; if(bytes>256*1024)throw new Error('单批同步数据超过 256 KiB。'); parts.push(part.value); } }
  finally { await reader.cancel().catch(()=>undefined); reader.releaseLock(); }
  const all=new Uint8Array(bytes); let offset=0; for(const part of parts){all.set(part,offset);offset+=part.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(all));
}

async function api(request: Request,env: Env): Promise<Response> {
  const url=new URL(request.url), path=url.pathname;
  if(path==='/api/auth/session' && request.method==='GET') return json({configured:configured(env),user:configured(env)?await user(request,env):null});
  if(!configured(env))return json({error:'尚未配置云同步，请先完成部署设置。'},503);
  if(path==='/api/auth/login' && request.method==='GET') {
    const state=random(), target=new URL('https://github.com/login/oauth/authorize');
    target.searchParams.set('client_id',env.GITHUB_CLIENT_ID!);
    target.searchParams.set('redirect_uri',`${url.origin}/api/auth/callback`);
    target.searchParams.set('state',state); target.searchParams.set('allow_signup','false');
    // No repository or email permissions: the public account ID is sufficient for this personal app.
    return new Response(null,{status:302,headers:{Location:target.toString(),'Set-Cookie':cookie(request,oauthCookie,state,600),'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  }
  if(path==='/api/auth/callback' && request.method==='GET') {
    const state=url.searchParams.get('state')??'', expected=cookies(request).get(oauthCookie)??'', code=url.searchParams.get('code');
    const clear=cookie(request,oauthCookie,'',0);
    if(!/^[a-f0-9]{64}$/.test(expected)||!same(state,expected)||!code||code.length>300) return redirect(request,'/?auth_error=invalid_state#/search',clear);
    try {
      const tokenResponse=await fetch('https://github.com/login/oauth/access_token',{method:'POST',headers:{Accept:'application/json','Content-Type':'application/json'},body:JSON.stringify({client_id:env.GITHUB_CLIENT_ID,client_secret:env.GITHUB_CLIENT_SECRET,code,redirect_uri:`${url.origin}/api/auth/callback`}),signal:AbortSignal.timeout(15000)});
      const token=await tokenResponse.json() as {access_token?:string};
      if(!tokenResponse.ok||!token.access_token)throw new Error('OAuth exchange failed');
      const profileResponse=await fetch('https://api.github.com/user',{headers:{Authorization:`Bearer ${token.access_token}`,Accept:'application/vnd.github+json','User-Agent':'WORDS-personal-sync'},signal:AbortSignal.timeout(15000)});
      const profile=await profileResponse.json() as {id?:number;login?:string};
      if(!profileResponse.ok||!Number.isSafeInteger(profile.id)||typeof profile.login!=='string')throw new Error('Profile lookup failed');
      if(String(profile.id)!==env.ALLOWED_GITHUB_ID)return redirect(request,'/?auth_error=not_allowed#/search',clear);
      const opaque=random(), tokenHash=await hash(opaque);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(Date.now()),
        env.DB.prepare('INSERT INTO sessions(token_hash,github_id,login,expires_at) VALUES(?,?,?,?)').bind(tokenHash,String(profile.id),profile.login,Date.now()+sessionLife*1000)
      ]);
      const response=redirect(request,'/#/search',clear);
      response.headers.append('Set-Cookie',cookie(request,sessionCookie,opaque,sessionLife));
      return response;
    } catch { return redirect(request,'/?auth_error=unavailable#/search',clear); }
  }
  const identity=await user(request,env); if(!identity)return json({error:'请使用你的 GitHub 账号登录。'},401);
  if(request.method!=='GET' && request.headers.get('Origin')!==url.origin) return json({error:'请求来源无效。'},403);
  if(path==='/api/auth/logout' && request.method==='POST') {
    const token=cookies(request).get(sessionCookie)!;
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await hash(token)).run();
    const response=json({ok:true}); response.headers.set('Set-Cookie',cookie(request,sessionCookie,'',0)); return response;
  }
  if(path==='/api/sync' && request.method==='GET') {
    const after=Number(url.searchParams.get('after')??'0');
    const max=await env.DB.prepare('SELECT COALESCE(MAX(revision),0) AS revision FROM sync_changes').first<{revision:number}>();
    const until=Number(url.searchParams.get('until')??max!.revision);
    if(!Number.isSafeInteger(after)||after<0||!Number.isSafeInteger(until)||until<after||until>max!.revision)return json({error:'同步游标无效。'},400);
    const result=await env.DB.prepare('SELECT record_key,entity,value,revision FROM sync_records WHERE revision > ? AND revision <= ? ORDER BY revision LIMIT 100').bind(after,until).all<Row>();
    const records=result.results.map(toRecord), next=records.length===100?records[records.length-1].revision:until;
    return json({records,next,until,more:next<until});
  }
  if(path==='/api/sync' && request.method==='POST') {
    let ops;
    try {
      const data=await readJson(request) as {operations?:unknown[]};
      if(!data || !Array.isArray(data.operations)||!data.operations.length||data.operations.length>10)throw new Error('每批需包含 1–10 项操作。');
      ops=data.operations.map(validateOperation);
      if(new Set(ops.map(op=>op.id)).size!==ops.length||new Set(ops.map(op=>op.key)).size!==ops.length)throw new Error('同步操作重复。');
      if(ops.some(op=>JSON.stringify(op.value).length>100000))throw new Error('同步记录过大。');
    } catch {return json({error:'同步请求格式无效或超过单批上限。'},400);}
    const results:SyncResult[]=[];
    for(const op of ops) {
      const value=op.value===null?null:JSON.stringify(op.value);
      // The change log and current record advance in a single D1 transaction. Retried operation IDs never apply twice.
      const statements=[
        env.DB.prepare(`INSERT INTO sync_changes(operation_id,record_key,entity,value,created_at)
          SELECT ?,?,?,?,? WHERE COALESCE((SELECT revision FROM sync_records WHERE record_key = ?),0) = ?
          ON CONFLICT(operation_id) DO NOTHING`).bind(op.id,op.key,op.entity,value,Date.now(),op.key,op.baseRevision),
        env.DB.prepare(`INSERT INTO sync_records(record_key,entity,value,revision,last_operation)
          SELECT record_key,entity,value,revision,operation_id FROM sync_changes WHERE operation_id = ?
          ON CONFLICT(record_key) DO UPDATE SET entity=excluded.entity,value=excluded.value,revision=excluded.revision,last_operation=excluded.last_operation
          WHERE excluded.revision > sync_records.revision`).bind(op.id),
        env.DB.prepare(`SELECT record_key,entity,value,revision,
          EXISTS(SELECT 1 FROM sync_changes WHERE operation_id = ? AND record_key = ?) AS accepted
          FROM sync_records WHERE record_key = ?`).bind(op.id,op.key,op.key)
      ];
      const batch=await env.DB.batch<Row>(statements), row=batch[2].results[0];
      if(!row) return json({error:'云端记录已变化，请重新同步。'},409);
      results.push({id:op.id,accepted:row.accepted===1,record:toRecord(row)});
    }
    return json({results});
  }
  return json({error:'接口不存在。'},404);
}

export default {
  async fetch(request: Request,env: Env): Promise<Response> {
    if(!new URL(request.url).pathname.startsWith('/api/'))return env.ASSETS.fetch(request);
    try { return await api(request,env); }
    catch { return json({error:'云同步暂时不可用，本机数据已保留，请稍后重试。'},503); }
  }
};
