import { readFile, readdir, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const files = await readdir(resolve(root, 'dist/assets'));
const sum = async (names, compressed = true) => (await Promise.all(names.map(async name => { const content = await readFile(resolve(root,'dist/assets',name)); return compressed ? gzipSync(content,{level:9}).length : content.length; }))).reduce((a,b) => a+b,0);
const initialJs = await sum(files.filter(f => /^index-.*\.js$/.test(f)));
const allJs = await sum(files.filter(f => f.endsWith('.js')));
const allCss = await sum(files.filter(f => f.endsWith('.css')));
const fonts = await sum(files.filter(f => f.endsWith('.woff2')),false);
const manifest = JSON.parse(await readFile(resolve(root,'public/dictionary/manifest.json'),'utf8'));
const shardFiles = (await readdir(resolve(root,'public/dictionary'))).filter(f => f.endsWith('.json') && f !== 'manifest.json');
let maxShard = 0;
for(const file of shardFiles) maxShard = Math.max(maxShard,gzipSync(await readFile(resolve(root,'public/dictionary',file)),{level:9}).length);
const manifestGzip = gzipSync(await readFile(resolve(root,'public/dictionary/manifest.json')),{level:9}).length;
const firstQuery = initialJs + allCss + fonts + maxShard + manifestGzip;
const metrics = {initialJsGzipKiB:initialJs/1024,allRoutesJsGzipKiB:allJs/1024,allCssGzipKiB:allCss/1024,woff2FontsKiB:fonts/1024,maxShardGzipKiB:maxShard/1024,firstQueryEstimatedKiB:firstQuery/1024,shardCount:shardFiles.length};
console.log(JSON.stringify(metrics,null,2));
if(initialJs>180*1024 || allCss>30*1024 || fonts>140*1024 || maxShard>300*1024 || firstQuery>800*1024 || shardFiles.length!==manifest.bucketCount) {
  throw new Error('Resource budget exceeded or shard manifest mismatch');
}
await stat(resolve(root,'dist/dictionary/manifest.json'));
for (const license of ['ECDICT-LICENSE.txt', 'WORDNET-LICENSE.txt', 'NEWSREADER-LICENSE.txt', 'INTER-LICENSE.txt', 'REACT-LICENSE.txt', 'REACT-DOM-LICENSE.txt', 'SCHEDULER-LICENSE.txt', 'LUCIDE-LICENSE.txt', 'DEXIE-LICENSE.txt', 'DEXIE-NOTICE.txt', 'THIRD-PARTY-NOTICES.txt']) {
  const file = await stat(resolve(root, 'dist/licenses', license));
  if (!file.isFile() || file.size === 0) throw new Error(`Missing or empty distribution license: ${license}`);
}
console.log('Production assets, dictionary shards and license budgets passed. Measurements assume gzip HTTP compression.');
