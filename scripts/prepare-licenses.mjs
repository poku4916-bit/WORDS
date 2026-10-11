import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const packages = [
  { name: 'react', label: 'React', file: 'REACT', url: 'https://github.com/facebook/react' },
  { name: 'react-dom', label: 'React DOM', file: 'REACT-DOM', url: 'https://github.com/facebook/react' },
  { name: 'scheduler', label: 'Scheduler', file: 'SCHEDULER', url: 'https://github.com/facebook/react' },
  { name: 'lucide-react', label: 'Lucide React', file: 'LUCIDE', url: 'https://github.com/lucide-icons/lucide' },
  { name: 'dexie', label: 'Dexie', file: 'DEXIE', url: 'https://github.com/dexie/Dexie.js', notice: true },
];
const destination = resolve('public/licenses');
mkdirSync(destination, { recursive: true });
const notices = ['WORDS runtime dependencies', '',
  'These notices accompany the JavaScript distributed with WORDS.',
  'Versions are read from installed packages locked by package-lock.json.', ''];
for (const item of packages) {
  const source = resolve('node_modules', item.name);
  const metadata = JSON.parse(readFileSync(resolve(source, 'package.json'), 'utf8'));
  copyFileSync(resolve(source, 'LICENSE'), resolve(destination, `${item.file}-LICENSE.txt`));
  notices.push(`${item.label} ${metadata.version} - ${metadata.license}`, item.url,
    `Full license: ${item.file}-LICENSE.txt`);
  if (item.notice) {
    copyFileSync(resolve(source, 'NOTICE'), resolve(destination, `${item.file}-NOTICE.txt`));
    notices.push(`Additional notice: ${item.file}-NOTICE.txt`);
  }
  notices.push('');
}
notices.push('Dictionary and font licenses are distributed separately in this directory:',
  'ECDICT-LICENSE.txt, WORDNET-LICENSE.txt, NEWSREADER-LICENSE.txt,',
  'INTER-LICENSE.txt and SOURCES.json.', '');
writeFileSync(resolve(destination, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n'));
console.log('Runtime dependency licenses and notices prepared.');
