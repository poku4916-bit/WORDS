import { readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'public/dictionary');
const destination = resolve(root, 'dist/dictionary');
await stat(resolve(root, 'dist/index.html'));
const manifest = JSON.parse(await readFile(resolve(source, 'manifest.json'), 'utf8'));
let compressedBytes = 0;
for (const shard of manifest.shards) {
  if (!/^shard-\d{3,5}-[a-f0-9]{16}\.json$/.test(shard.file)) throw new Error('Unsafe source shard filename');
  const raw = await readFile(resolve(source, shard.file));
  if (raw.length !== shard.bytes || createHash('sha256').update(raw).digest('hex') !== shard.sha256) {
    throw new Error(`Source shard does not match manifest: ${shard.file}`);
  }
  const compressed = gzipSync(raw, { level: 9 });
  const originalFile = shard.file;
  shard.file += '.gz';
  shard.compression = 'gzip';
  shard.gzipBytes = compressed.length;
  await writeFile(resolve(destination, shard.file), compressed);
  // Remove only this known build-output file, never the original public source.
  await unlink(resolve(destination, originalFile)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  compressedBytes += compressed.length;
}
manifest.stats.maxGzipBytes = Math.max(...manifest.shards.map(shard => shard.gzipBytes));
await writeFile(resolve(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`Production dictionary: ${manifest.stats.entries.toLocaleString('en-US')} entries in ${manifest.shards.length} gzip shards, ${(compressedBytes / 1024 / 1024).toFixed(2)} MiB. Original sources retained.`);
