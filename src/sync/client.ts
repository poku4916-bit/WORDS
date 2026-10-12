import { useSyncExternalStore } from 'react';
import { db } from '../storage/database';
import { dictionaryService } from '../services/dictionary';
import type { Preferences } from '../types';
import { SyncEngine, parsePreference, type SyncTransport } from './engine';

export type SyncMode = 'checking'|'local'|'signed-out'|'syncing'|'synced'|'pending'|'offline'|'error';
export interface SyncStatus { mode:SyncMode; configured:boolean; user:{id:string;login:string}|null; message:string; lastSyncedAt?:number }
type Callbacks={changed:()=>Promise<void>;preferences:(value:Preferences)=>void};
export class ApiError extends Error { constructor(message:string,readonly status:number){super(message);} }
export async function api<T>(path:string,body?:unknown):Promise<T>{
  const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(20000),cache:'no-store'});
  const data=await response.json() as {error?:unknown};
  if(!response.ok)throw new ApiError(typeof data.error==='string'?data.error:'云同步暂时不可用。',response.status);
  return data as T;
}
export const httpTransport:SyncTransport={pull:(after,until)=>api(`/api/sync?after=${after}${until===undefined?'':`&until=${until}`}`),push:operations=>api('/api/sync',{operations})};
class SyncClient {
  private status:SyncStatus={mode:'checking',configured:false,user:null,message:'正在检查同步状态'};
  private subscribers=new Set<()=>void>();
  private callbacks?:Callbacks;
  private timer?:ReturnType<typeof setTimeout>;
  private poll?:ReturnType<typeof setInterval>;
  private running?:Promise<void>;
  private checking?:Promise<void>;
  private again=false;
  getStatus=()=>this.status;
  subscribe=(callback:()=>void)=>{this.subscribers.add(callback);return()=>{this.subscribers.delete(callback);};};
  private publish(update:Partial<SyncStatus>){this.status={...this.status,...update};for(const subscriber of this.subscribers)subscriber();}
  private engine=new SyncEngine({database:db,transport:httpTransport,lookup:word=>dictionaryService.lookup(word),getPreferences:()=>{const value=localStorage.getItem('words.preferences');return value?parsePreference(JSON.parse(value)):null;},setPreferences:value=>{localStorage.setItem('words.preferences',JSON.stringify(value));this.callbacks?.preferences(value);}});
  private wake=()=>{if(document.visibilityState!=='hidden')void this.checkSession().then(()=>this.run());};
  start(callbacks:Callbacks):()=>void{
    this.callbacks=callbacks;
    if(this.poll)clearInterval(this.poll);
    this.poll=setInterval(()=>{if(document.visibilityState!=='hidden'&&this.status.user)void this.run();},30000);
    window.addEventListener('focus',this.wake);window.addEventListener('online',this.wake);
    void this.checkSession().then(()=>this.run());
    return()=>{clearInterval(this.poll);clearTimeout(this.timer);window.removeEventListener('focus',this.wake);window.removeEventListener('online',this.wake);this.callbacks=undefined;};
  }
  async checkSession():Promise<void>{
    if(this.checking)return this.checking;
    this.checking=(async()=>{
      try{
        const result=await api<{configured:boolean;user:SyncStatus['user']}>('/api/auth/session');
        if(typeof result.configured!=='boolean')throw new Error('No sync API');
        if(result.user){
          const owner=(await db.syncMeta.get('owner'))?.value;
          if(owner && owner!==result.user.id){this.publish({mode:'error',user:null,configured:true,message:'同步账号已改变，请先导出本机备份再切换。'});return;}
          await db.syncMeta.put({key:'owner',value:result.user.id});
        }
        this.publish({configured:result.configured,user:result.user,mode:result.user?'pending':result.configured?'signed-out':'local',message:result.user?'准备同步':result.configured?'登录后自动同步':'当前仅保存在本机'});
      }catch{
        if(!navigator.onLine)this.publish({mode:'offline',message:'离线使用中，联网后继续同步'});
        else if(this.status.configured)this.publish({mode:'error',message:'暂时无法连接云端，本机数据已保留'});
        else this.publish({mode:'local',message:'当前仅保存在本机'});
      }
    })().finally(()=>{this.checking=undefined;});
    return this.checking;
  }
  request(){
    if(!this.status.user)return;
    this.publish({mode:navigator.onLine?'pending':'offline',message:navigator.onLine?'有变更待同步':'离线使用中，变更待同步'});
    clearTimeout(this.timer);this.timer=setTimeout(()=>void this.run(),1500);
    if(this.running)this.again=true;
  }
  async run():Promise<void>{
    if(this.running){this.again=true;return this.running;}
    if(!this.status.user||!this.status.configured)return;
    if(!navigator.onLine){this.publish({mode:'offline',message:'离线使用中，联网后继续同步'});return;}
    this.running=(async()=>{
      this.publish({mode:'syncing',message:'正在同步'});
      try{
        // A browser-wide lock serializes durable queue acknowledgements across tabs.
        if(!navigator.locks)throw new Error('当前浏览器不支持安全的多标签页同步，请更新浏览器。');
        const done=await navigator.locks.request('words.cloud-sync',{ifAvailable:true},async lock=>{if(!lock)return false;await this.engine.sync();return true;});
        if(!done){this.publish({mode:'pending',message:'另一个页面正在同步'});return;}
        const lastSyncedAt=Date.now();await db.syncMeta.put({key:'lastSyncedAt',value:lastSyncedAt});
        await this.callbacks?.changed();this.publish({mode:'synced',message:'已同步',lastSyncedAt});
      }catch(error){
        if(error instanceof ApiError&&error.status===401)this.publish({mode:'signed-out',user:null,message:'登录已过期，请重新登录'});
        else this.publish({mode:navigator.onLine?'error':'offline',message:error instanceof Error?error.message:'同步失败，本机数据已保留'});
      }
    })().finally(()=>{this.running=undefined;if(this.again){this.again=false;this.request();}});
    return this.running;
  }
  async logout(){await this.run();await api('/api/auth/logout',{});await this.checkSession();}
}
export const syncClient=new SyncClient();
export const useSyncStatus=()=>useSyncExternalStore(syncClient.subscribe,syncClient.getStatus,syncClient.getStatus);
