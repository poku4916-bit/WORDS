import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { DictionaryService, normalizeQuery, isWordEntry } from '../src/services/dictionary';
import type { DictionaryManifest } from '../src/services/dictionary';
import { shardIndex } from '../src/dictionary/core.mjs';
import { parseIndex, parseSynset } from '../scripts/parse-wordnet.mjs';

const publicDirectory = new URL('../public/', import.meta.url);
const manifest: DictionaryManifest = JSON.parse(await readFile(new URL('dictionary/manifest.json', publicDirectory), 'utf8'));
const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function fileFetcher(requests: string[] = []): typeof fetch {
  return (async input => {
    const url = String(input);
    requests.push(url);
    const file = url.slice(url.indexOf('dictionary/'));
    return new Response(await readFile(new URL(file, publicDirectory)));
  }) as typeof fetch;
}

const bankBucket = shardIndex('bank', manifest.bucketCount);
const bankBytes = await readFile(new URL('dictionary/' + manifest.shards[bankBucket].file, publicDirectory));
const bankGzip = gzipSync(bankBytes, { level: 9 });
function gzipManifest(): DictionaryManifest {
  const result = structuredClone(manifest);
  result.shards[bankBucket].file += '.gz';
  result.shards[bankBucket].compression = 'gzip';
  result.shards[bankBucket].gzipBytes = bankGzip.byteLength;
  return result;
}
function gzipFetcher(data: DictionaryManifest, body: () => Uint8Array<ArrayBuffer> = () => bankGzip): typeof fetch {
  return (async input => String(input).endsWith('manifest.json') ? Response.json(data) : new Response(body())) as typeof fetch;
}

describe('dictionary normalization and primary formats', () => {
  it('normalizes Unicode, case, surrounding spaces and apostrophes with no stemming', () => {
    expect(normalizeQuery(' Ｂank ')).toBe('bank');
    expect(normalizeQuery('don’t')).toBe("don't");
    expect(normalizeQuery('  Mother-in-law  ')).toBe('mother-in-law');
    expect(normalizeQuery('running')).toBe('running');
    expect(normalizeQuery(' New York ')).toBe('new york');
    for (const query of ['', '  ', '词典', 'a'.repeat(81), 'ba\u0000nk']) {
      expect(() => normalizeQuery(query)).toThrowError(expect.objectContaining({ code: 'INVALID_QUERY' }));
    }
  });

  it('uses a stable UTF-8 FNV-1a hash shared with the generator', () => {
    expect(shardIndex('hello', 2 ** 32)).toBe(0x4f9f2cab);
    expect(shardIndex('bank', 512)).toBe(151);
    expect(shardIndex(normalizeQuery(' Bank '), 512)).toBe(shardIndex('bank', 512));
  });

  it('retains POS satellite identity and separates examples from quoted definition terms', () => {
    const sense = parseSynset('00001740 00 s 02 able(p) 0 capable 0 000 | having the "means" to do things; "she was able"; "he was capable"');
    expect(sense.id).toBe('wn:3.0:s:00001740');
    expect(sense.words).toEqual(['able', 'capable']);
    expect(sense.definition).toBe('having the "means" to do things');
    expect(sense.examples).toEqual(['she was able', 'he was capable']);
    expect(parseIndex('bank n 2 1 @ 2 1 09213565 08420278').offsets).toEqual(['09213565', '08420278']);
    expect(() => parseSynset('00001740 00 s 04 word 0 000 | malformed')).toThrow();
    expect(() => parseIndex('bank n 2 1 @ 2 1 09213565')).toThrow();
  });
});

describe('complete pinned static dictionary', () => {
  it('ships the full dataset, measured 512 shards and original licenses', async () => {
    expect(manifest.bucketCount).toBe(512);
    expect(manifest.shards).toHaveLength(512);
    expect(manifest.stats.entries).toBe(772845);
    expect(manifest.stats.wordnetSynsets).toBe(117659);
    expect(manifest.stats.malformedCsvRecords).toBe(0);
    expect(manifest.stats.malformedWordnetRecords).toBe(0);
    expect(manifest.shards.every(shard => shard.gzipBytes <= 300 * 1024)).toBe(true);
    expect(manifest.shards.reduce((sum, shard) => sum + shard.entries, 0)).toBe(manifest.stats.entries);
    for (const source of manifest.sources) {
      expect(sha256(await readFile(new URL(source.license.file, publicDirectory)))).toBe(source.license.sha256);
    }
  });

  it('loads exactly manifest plus one bucket under a deployment base and caches normalized queries', async () => {
    const requests: string[] = [];
    const service = new DictionaryService({ baseUrl: '/words/', fetcher: fileFetcher(requests) });
    const bank = await service.lookup('Bank');
    expect(bank.id).toBe('en:bank');
    expect(isWordEntry(bank)).toBe(true);
    expect((await service.lookup(' bank ')).id).toBe(bank.id);
    expect(requests).toEqual(['/words/dictionary/manifest.json', '/words/dictionary/' + manifest.shards[shardIndex('bank')].file]);
    bank.word = 'caller-mutated';
    expect((await service.lookup('bank')).word).toBe('bank');
  });

  it('keeps financial bank synonyms out of the riverbank sense', async () => {
    const bank = await new DictionaryService({ fetcher: fileFetcher() }).lookup('bank');
    const river = bank.englishSenses.find(sense => sense.id === 'wn:3.0:n:09213565');
    const financial = bank.englishSenses.find(sense => sense.id === 'wn:3.0:n:08420278');
    expect(river?.definition).toContain('slope beside a body of water');
    expect(river?.synonyms).toEqual([]);
    expect(financial?.synonyms).toEqual(['depository financial institution', 'banking concern', 'banking company']);
    expect(financial?.examples.length).toBeGreaterThan(0);
    expect(bank.chineseGlosses.some(gloss => gloss.text.includes('银行'))).toBe(true);
    expect(bank.englishSenses.some(sense => sense.source === 'ECDICT')).toBe(true);
  });

  it('audits bilingual definitions and per-sense synonym identity for all 30 common words', async () => {
    const words = ['bank', 'light', 'run', 'spring', 'book', 'right', 'set', 'take', 'make', 'get', 'work', 'love', 'good', 'happy',
      'learn', 'study', 'read', 'write', 'speak', 'word', 'time', 'water', 'home', 'food', 'friend', 'child', 'school', 'computer', 'beautiful', 'change'];
    const service = new DictionaryService({ fetcher: fileFetcher() });
    for (const word of words) {
      const entry = await service.lookup(word);
      expect(entry.contentStatus, word).toEqual({ chinese: true, english: true });
      expect(entry.chineseGlosses.length, word).toBeGreaterThan(0);
      expect(entry.englishSenses.length, word).toBeGreaterThan(0);
      expect(new Set(entry.englishSenses.map(sense => sense.id)).size, word).toBe(entry.englishSenses.length);
      for (const sense of entry.englishSenses) {
        expect(sense.synonyms.map(normalizeQuery), `${word}:${sense.id}`).not.toContain(word);
        expect(new Set(sense.synonyms.map(normalizeQuery)).size, `${word}:${sense.id}`).toBe(sense.synonyms.length);
      }
    }
    expect((await service.lookup('run')).englishSenses.filter(sense => sense.source === 'WordNet 3.0').length).toBeGreaterThan(30);
    expect((await service.lookup('light')).englishSenses.some(sense => sense.pos === 'adjective satellite')).toBe(true);
    expect((await service.lookup('spring')).englishSenses.find(sense => sense.id === 'wn:3.0:n:15237044')?.synonyms).toEqual(['springtime']);
  }, 20000);
});

describe('dictionary errors and retries', () => {
  it('rejects invalid inputs before fetching and distinguishes an exact not-found query', async () => {
    const fetcher = vi.fn(fileFetcher());
    const service = new DictionaryService({ fetcher });
    await expect(service.lookup('')).rejects.toMatchObject({ code: 'INVALID_QUERY' });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(service.lookup('zzzzthisisnotarealwordzzzz')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.lookup('bankz')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('does not cache failed downloads and can retry', async () => {
    const successful = fileFetcher();
    let fail = true;
    const fetcher: typeof fetch = async (input, init) => {
      if (fail) { fail = false; throw new TypeError('offline'); }
      return successful(input, init);
    };
    const service = new DictionaryService({ fetcher });
    await expect(service.lookup('bank')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
    await expect(service.lookup('bank')).resolves.toMatchObject({ id: 'en:bank' });
  });

  it('classifies non-success HTTP statuses as network failures', async () => {
    const service = new DictionaryService({ fetcher: (async () => new Response('', { status: 503 })) as typeof fetch });
    await expect(service.lookup('bank')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('detects malformed manifest data, unsafe shard paths and altered shard checksums', async () => {
    const malformed = new DictionaryService({ fetcher: (async () => new Response('{broken')) as typeof fetch });
    await expect(malformed.lookup('bank')).rejects.toMatchObject({ code: 'DATA_ERROR' });
    const badManifest = structuredClone(manifest);
    badManifest.shards[0].file = '../secret';
    const unsafe = new DictionaryService({ fetcher: (async () => Response.json(badManifest)) as typeof fetch });
    await expect(unsafe.lookup('bank')).rejects.toMatchObject({ code: 'DATA_ERROR' });
    const original = fileFetcher();
    const corrupted = new DictionaryService({ fetcher: (async (input, init) => {
      const response = await original(input, init);
      if (String(input).endsWith('manifest.json')) return response;
      const text = await response.text();
      return new Response(text.replace('sloping land', 'sloping sand'));
    }) as typeof fetch });
    await expect(corrupted.lookup('bank')).rejects.toMatchObject({ code: 'DATA_ERROR' });
  });
});

describe('gzip deployment dictionary', () => {
  it('decodes the real bank shard and retains source senses and the original digest', async () => {
    const data = gzipManifest();
    const fetcher = vi.fn(gzipFetcher(data));
    const service = new DictionaryService({ baseUrl: '/words/', fetcher });
    const bank = await service.lookup('bank');
    expect(bank).toEqual((JSON.parse(bankBytes.toString()) as { entries: Record<string, unknown> }).entries.bank);
    expect(sha256(bankBytes)).toBe(data.shards[bankBucket].sha256);
    expect((await service.lookup(' Ｂank ')).id).toBe('en:bank');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[1][0])).toBe('/words/dictionary/' + data.shards[bankBucket].file);
  });

  it('accepts bytes already decoded by HTTP Content-Encoding', async () => {
    const service = new DictionaryService({ fetcher: gzipFetcher(gzipManifest(), () => bankBytes) });
    await expect(service.lookup('bank')).resolves.toMatchObject({ id: 'en:bank' });
  });

  it('rejects mismatched compression flags and limits declared uncompressed bytes', async () => {
    for (const change of [
      (data: DictionaryManifest) => { delete data.shards[bankBucket].compression; },
      (data: DictionaryManifest) => { data.shards[bankBucket].file = manifest.shards[bankBucket].file; },
      (data: DictionaryManifest) => { data.shards[bankBucket].bytes = 4 * 1024 * 1024 + 1; },
    ]) {
      const data = gzipManifest();
      change(data);
      const service = new DictionaryService({ fetcher: gzipFetcher(data) });
      await expect(service.lookup('bank')).rejects.toMatchObject({ code: 'DATA_ERROR' });
    }
  });

  it('rejects damaged gzip data without caching the failure, then retries', async () => {
    const damaged = Buffer.from(bankGzip);
    damaged[damaged.length - 5] ^= 0xff;
    let fail = true;
    const fetcher = vi.fn(gzipFetcher(gzipManifest(), () => {
      if (fail) { fail = false; return damaged; }
      return bankGzip;
    }));
    const service = new DictionaryService({ fetcher });
    await expect(service.lookup('bank')).rejects.toMatchObject({ code: 'DATA_ERROR', message: '词典压缩分片损坏，请重试。' });
    await expect(service.lookup('bank')).resolves.toMatchObject({ id: 'en:bank' });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('checks the original JSON digest after decompression', async () => {
    const altered = gzipSync(bankBytes.toString().replace('sloping land', 'sloping sand'), { level: 9 });
    const data = gzipManifest();
    data.shards[bankBucket].gzipBytes = altered.byteLength;
    const service = new DictionaryService({ fetcher: gzipFetcher(data, () => altered) });
    await expect(service.lookup('bank')).rejects.toMatchObject({ code: 'DATA_ERROR', message: '词典分片校验失败。' });
  });

  it('stops decompression when output exceeds the declared size', async () => {
    const data = gzipManifest();
    data.shards[bankBucket].bytes = bankBytes.byteLength - 1;
    const service = new DictionaryService({ fetcher: gzipFetcher(data) });
    await expect(service.lookup('bank')).rejects.toMatchObject({ code: 'DATA_ERROR', message: '词典分片解压长度超过版本清单。' });
  });

  it('reports missing decompression support accurately while allowing HTTP-decoded bytes', async () => {
    vi.stubGlobal('DecompressionStream', undefined);
    try {
      const service = new DictionaryService({ fetcher: gzipFetcher(gzipManifest()) });
      await expect(service.lookup('bank')).rejects.toMatchObject({ code: 'DATA_ERROR', message: '当前浏览器无法解压词典资源，请更新浏览器后重试。' });
      const alreadyDecoded = new DictionaryService({ fetcher: gzipFetcher(gzipManifest(), () => bankBytes) });
      await expect(alreadyDecoded.lookup('bank')).resolves.toMatchObject({ id: 'en:bank' });
    } finally { vi.unstubAllGlobals(); }
  });
});
