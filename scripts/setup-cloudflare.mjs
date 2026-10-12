import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const wrangler=resolve(root,'node_modules/wrangler/bin/wrangler.js');
const command=(args)=>{const result=spawnSync(process.execPath,[wrangler,...args],{cwd:root,stdio:'inherit'});if(result.status!==0)throw new Error('Cloudflare 操作失败，请检查登录和免费账户状态。');};
const capture=(args)=>{const result=spawnSync(process.execPath,[wrangler,...args],{cwd:root,encoding:'utf8'});if(result.status!==0)throw new Error('无法查询 Cloudflare 数据库，请先运行 npx wrangler login。');return result.stdout;};
const configuration=resolve(root,'wrangler.jsonc');
const config=JSON.parse(await readFile(configuration,'utf8'));
if(!config.d1_databases[0].database_id){
  const list=JSON.parse(capture(['d1','list','--json']));
  let database=list.find(item=>item.name==='words-personal');
  if(!database){command(['d1','create','words-personal']);database=JSON.parse(capture(['d1','list','--json'])).find(item=>item.name==='words-personal');}
  if(!database?.uuid)throw new Error('未找到创建的 D1 数据库。');
  config.d1_databases[0].database_id=database.uuid;
  await writeFile(configuration,JSON.stringify(config,null,2)+'\n');
}
command(['d1','migrations','apply','words-personal','--remote']);
console.log('D1 已配置。首次部署后，按 docs/CLOUDFLARE.md 配置 GitHub 登录应用。');
