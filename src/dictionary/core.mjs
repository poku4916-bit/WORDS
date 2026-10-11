/** Shared by the browser adapter and the offline converter. Never stem a query. */
export function normalizeKey(value) {
  return value.normalize('NFKC').trim().replace(/[\u2018\u2019\u02bc\uff07]/g, "'").toLowerCase();
}

/** FNV-1a over UTF-8 bytes, unsigned 32-bit. The exact algorithm is in manifest.json. */
export function shardIndex(key, bucketCount = 512) {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(key)) {
    hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
  }
  return hash % bucketCount;
}
