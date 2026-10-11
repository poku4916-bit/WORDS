import { mkdir, readFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sources } from './dictionary-sources.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cache = path.join(root, '.cache/dictionary');
await mkdir(cache, { recursive: true });
async function verified(file, digest) {
  try { return createHash('sha256').update(await readFile(file)).digest('hex') === digest; }
  catch { return false; }
}
async function download(file, url, digest) {
  const target = path.join(cache, file);
  if (await verified(target, digest)) return;
  const temporary = target + '.download';
  const result = spawnSync(process.platform === 'win32' ? 'curl.exe' : 'curl',
    ['--fail', '--location', '--retry', '3', '--connect-timeout', '20', '--max-time', '300',
      '--header', 'Accept: application/vnd.github.raw+json', '--output', temporary, url], { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Download failed: ${file}`);
  if (!await verified(temporary, digest)) throw new Error(`SHA-256 mismatch: ${file}; expected ${digest}`);
  await rename(temporary, target);
}
await download(sources.ecdict.file, sources.ecdict.downloadUrl, sources.ecdict.sha256);
await download(sources.ecdict.licenseFile, sources.ecdict.licenseUrl, sources.ecdict.licenseSha256);
await download(sources.wordnet.file, sources.wordnet.downloadUrl, sources.wordnet.sha256);
// Re-extract only the checksum-verified archive, also repairing a corrupted local extraction.
const result = spawnSync('tar', ['-xf', path.join(cache, sources.wordnet.file), '-C', cache], { stdio: 'inherit' });
if (result.status !== 0) throw new Error('Cannot extract WordNet archive; install a zip-capable tar.');
console.log('Pinned ECDICT and Princeton WordNet 3.0 source downloads verified.');
