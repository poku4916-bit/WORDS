import { readFile, readdir, stat } from 'node:fs/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const files = await readdir(resolve(root, 'dist/assets'));
const sum = async (names, compressed = true) => (await Promise.all(names.map(async name => { const content = await readFile(resolve(root,'dist/assets',name)); return compressed ? gzipSync(content,{level:9}).length : content.length; }))).reduce((a,b) => a+b,0);
const initialJs = await sum(files.filter(f => /^index-.*\.js$/.test(f)));
const allJs = await sum(files.filter(f => f.endsWith('.js')));
const allCss = await sum(files.filter(f => f.endsWith('.css')));
const fonts = await sum(files.filter(f => f.endsWith('.woff2')),false);
const manifest = JSON.parse(await readFile(resolve(root,'dist/dictionary/manifest.json'),'utf8'));
const shardFiles = (await readdir(resolve(root,'dist/dictionary'))).filter(f => f !== 'manifest.json');
const expectedFiles = new Set(manifest.shards.map(shard => shard.file));
if(manifest.shards.length !== manifest.bucketCount || expectedFiles.size !== manifest.bucketCount || shardFiles.length !== expectedFiles.size || shardFiles.some(file => !expectedFiles.has(file)) || manifest.shards.reduce((sum, shard) => sum + shard.entries, 0) !== manifest.stats.entries) {
  throw new Error('Production manifest and shard files do not contain the complete dictionary');
}
let maxShard = 0;
let totalShardBytes = 0;
for(const shard of manifest.shards) {
  if (shard.compression !== 'gzip' || !/^shard-\d{3,5}-[a-f0-9]{16}\.json\.gz$/.test(shard.file)) throw new Error('Production shard must be a safe gzip file');
  const compressed = await readFile(resolve(root, 'dist/dictionary', shard.file));
  const raw = gunzipSync(compressed, { maxOutputLength: 4 * 1024 * 1024 });
  if(compressed.length !== shard.gzipBytes || raw.length !== shard.bytes || createHash('sha256').update(raw).digest('hex') !== shard.sha256) throw new Error(`Production shard integrity mismatch: ${shard.file}`);
  totalShardBytes += compressed.length;
  maxShard = Math.max(maxShard, compressed.length);
}
const manifestGzip = gzipSync(await readFile(resolve(root,'dist/dictionary/manifest.json')),{level:9}).length;
const firstQuery = initialJs + allCss + fonts + maxShard + manifestGzip;
const metrics = {initialJsGzipKiB:initialJs/1024,allRoutesJsGzipKiB:allJs/1024,allCssGzipKiB:allCss/1024,woff2FontsKiB:fonts/1024,maxShardGzipKiB:maxShard/1024,firstQueryEstimatedKiB:firstQuery/1024,shardCount:shardFiles.length,productionDictionaryMiB:totalShardBytes/1024/1024};
console.log(JSON.stringify(metrics,null,2));
if(initialJs>180*1024 || allCss>30*1024 || fonts>140*1024 || maxShard>300*1024 || firstQuery>800*1024 || shardFiles.length!==manifest.bucketCount) {
  throw new Error('Resource budget exceeded or shard manifest mismatch');
}
async function treeBytes(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    total += entry.isDirectory() ? await treeBytes(path) : (await stat(path)).size;
  }
  return total;
}
const expandedBuildBytes = await treeBytes(resolve(root, 'dist'));
if(expandedBuildBytes >= 256 * 1024 * 1024) throw new Error('Sites expanded archive limit exceeded');
console.log(`Expanded production output: ${(expandedBuildBytes/1024/1024).toFixed(2)} MiB / 256 MiB.`);
await stat(resolve(root,'dist/dictionary/manifest.json'));
for (const license of ['ECDICT-LICENSE.txt', 'WORDNET-LICENSE.txt', 'NEWSREADER-LICENSE.txt', 'INTER-LICENSE.txt', 'REACT-LICENSE.txt', 'REACT-DOM-LICENSE.txt', 'SCHEDULER-LICENSE.txt', 'LUCIDE-LICENSE.txt', 'DEXIE-LICENSE.txt', 'DEXIE-NOTICE.txt', 'THIRD-PARTY-NOTICES.txt']) {
  const file = await stat(resolve(root, 'dist/licenses', license));
  if (!file.isFile() || file.size === 0) throw new Error(`Missing or empty distribution license: ${license}`);
}
console.log('Production assets, dictionary shards and license budgets passed. Measurements assume gzip HTTP compression.');
