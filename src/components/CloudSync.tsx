import { useState } from 'react';
import { Cloud, CloudOff, Github, LogOut, RefreshCw } from 'lucide-react';
import { syncClient, useSyncStatus } from '../sync/client';

export function SyncIndicator({onClick}:{onClick:()=>void}){
  const state=useSyncStatus();
  return <button className={`sync-trigger sync-${state.mode}`} onClick={onClick} aria-label={`账户与同步：${state.message}`} title={state.message}>
    {state.mode==='offline'||state.mode==='error'?<CloudOff size={18}/>:<Cloud size={18}/>}<span>{state.user?state.mode==='synced'?'已同步':state.mode==='syncing'?'同步中':'待同步':'账户与同步'}</span>
  </button>;
}
export default function CloudSync(){
  const state=useSyncStatus(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const logout=async()=>{setBusy(true);setError('');try{await syncClient.logout();}catch{setError('暂时无法退出，请联网后重试。');}finally{setBusy(false);}};
  return <div className="settings-body cloud-sync-panel"><span className="eyebrow">YOUR WORDS, EVERYWHERE</span><h3>让积累随你而行。</h3>
    <p>用同一个 GitHub 账号登录，在手机和电脑间自动同步词本、笔记、学习进度、复习记录与偏好。</p>
    <div className={`sync-status-card sync-${state.mode}`} role="status"><Cloud size={24}/><div><strong>{state.user?`@${state.user.login}`:'本机单词本'}</strong><p>{state.message}</p>{state.lastSyncedAt&&<small>上次同步：{new Date(state.lastSyncedAt).toLocaleString('zh-CN')}</small>}</div></div>
    {state.user?<div className="inline-actions"><button className="button button-primary" disabled={busy||state.mode==='syncing'} onClick={()=>{void syncClient.run();}}><RefreshCw size={17}/>立即同步</button><button className="button" disabled={busy||state.mode==='syncing'} onClick={()=>void logout()}><LogOut size={17}/>退出登录</button></div>:state.configured?<a className="button button-primary" href="/api/auth/login"><Github size={18}/>使用 GitHub 登录</a>:<p className="notice">当前地址使用本机模式。词本可以继续使用，也可以在“备份恢复”中导出保存。</p>}
    <p className="muted">个人云端数据仅允许已配置的本人账号访问。修改先保存在本机，联网后自动补传；正在进行的练习会话保留在当前设备。</p>
    <p className="muted">首次从旧网址迁移时，在旧站导出 JSON，再到这里的“备份恢复”合并导入一次。</p>
    {state.mode==='signed-out'&&<p className="muted">本机已有词本会在登录后与云端合并。退出登录不会清除当前设备上的个人数据。</p>}
    {error&&<p className="notice notice-error" role="alert">{error}</p>}
  </div>;
}
