/** Parse an official WordNet data.pos row, retaining adjective-satellite identity. */
export function parseSynset(line) {
  const separator = line.indexOf('|');
  if (separator < 0) throw new Error('Missing gloss separator');
  const tokens = line.slice(0, separator).trim().split(/\s+/);
  const [offset, , type, countHex] = tokens;
  const count = Number.parseInt(countHex, 16);
  if (!/^\d{8}$/.test(offset) || !['n', 'v', 'a', 's', 'r'].includes(type) || !Number.isInteger(count) || count < 1) {
    throw new Error('Invalid synset header');
  }
  let cursor = 4;
  const words = [];
  for (let i = 0; i < count; i++) {
    const word = tokens[cursor++];
    const lexId = tokens[cursor++];
    if (!word || !/^[0-9a-f]+$/i.test(lexId ?? '')) throw new Error('Invalid word / lex_id');
    words.push(word.replace(/\((?:a|p|ip)\)$/, '').replaceAll('_', ' '));
  }
  const pointers = Number(tokens[cursor++]);
  if (!Number.isInteger(pointers) || pointers < 0 || cursor + pointers * 4 > tokens.length) throw new Error('Invalid pointers');
  cursor += pointers * 4;
  if (type === 'v') {
    const frames = Number(tokens[cursor++]);
    if (!Number.isInteger(frames) || frames < 0 || cursor + frames * 3 !== tokens.length) throw new Error('Invalid verb frames');
    cursor += frames * 3;
  }
  if (cursor !== tokens.length) throw new Error('Unexpected trailing synset fields');
  const gloss = line.slice(separator + 1).trim();
  const examples = [];
  // Quoted text is an example only if it occupies an entire semicolon segment.
  // Definitions such as “a ...” retain their embedded quoted terms.
  const definition = gloss.replace(/(?:^|;\s*)"([^"\r\n]*)"(?=\s*(?:;|$))/g, (_match, example) => {
    examples.push(example); return '';
  }).replace(/;\s*$/, '').trim();
  if (!definition) throw new Error('Missing definition');
  return { id: `wn:3.0:${type}:${offset}`, offset, type, words, definition, examples };
}

/** Index offsets retain WordNet's per-lemma, per-POS sense ordering. */
export function parseIndex(line) {
  const tokens = line.trim().split(/\s+/);
  const [lemma, pos] = tokens;
  const count = Number(tokens[2]);
  const pointerCount = Number(tokens[3]);
  const start = 6 + pointerCount;
  if (!lemma || !['n', 'v', 'a', 'r'].includes(pos) || !Number.isInteger(count) || count < 1 ||
      !Number.isInteger(pointerCount) || pointerCount < 0 || tokens.length !== start + count ||
      !tokens.slice(start).every(offset => /^\d{8}$/.test(offset))) throw new Error('Invalid WordNet index row');
  return { word: lemma.replaceAll('_', ' '), pos, offsets: tokens.slice(start) };
}
