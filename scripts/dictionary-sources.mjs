export const sources = {
  ecdict: {
    name: 'ECDICT', version: 'bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b',
    url: 'https://github.com/skywind3000/ECDICT/tree/bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b',
    downloadUrl: 'https://api.github.com/repos/skywind3000/ECDICT/contents/ecdict.csv?ref=bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b',
    file: 'ecdict.csv', sha256: '1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf',
    licenseUrl: 'https://api.github.com/repos/skywind3000/ECDICT/contents/LICENSE?ref=bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b',
    licenseFile: 'ECDICT-LICENSE.txt', licenseSha256: 'f8552dd246f61a4e064569eae6194a01c6b3d63b03bf27c6ca863593c549ed0f',
  },
  wordnet: {
    name: 'Princeton WordNet', version: '3.0', url: 'https://wordnet.princeton.edu/',
    officialArchiveUrl: 'https://wordnetcode.princeton.edu/3.0/WordNet-3.0.tar.gz',
    distributor: 'NLTK nltk_data (Princeton database repackaged, not a different WordNet)',
    distributorCommit: '96f9b3252457a2b97e52aec64c3dfceeb5c312d5',
    downloadUrl: 'https://api.github.com/repos/nltk/nltk_data/contents/packages/corpora/wordnet.zip?ref=96f9b3252457a2b97e52aec64c3dfceeb5c312d5',
    file: 'wordnet.zip', sha256: 'cbda5ea6eef7f36a97a43d4a75f85e07fccbb4f23657d27b4ccbc93e2646ab59',
    licenseFile: 'wordnet/LICENSE', licenseSha256: '7731175a77952e259390b496fab905e57118b8d19ad3a8383c67eee724ff443f',
    databaseFiles: {
      'data.noun': '489f145e0f68877c0be5bd0eb4117adaaac52f38f6204eb8d85dbe2158b614cc',
      'data.verb': '29cc96ed80c9f47d94fe75e332a9df80f4b1c737205f92d2f433d63c6da2ab51',
      'data.adj': 'f24b635368be441501c9b8001e9271fd3b30b203f00d91e332979e6f8fe35646',
      'data.adv': 'e66dbbda0e0359e41b7f225bff71dd0c263dc7c66c1b61abc9ba334973d92979',
      'index.noun': 'a490d99d93d017bf4822fe2f0ffa51fd73911ce271dc7535fade21f8814b5a04',
      'index.verb': 'c7c79b558d787f1e31c6f8b3eeadb8fcbb26a64545ecc1241e21d9b61f95ee8e',
      'index.adj': '42f58dda2c7cff66eb8fa55ba62e0a873a9b3f43c878e8201108f5dab6dcff28',
      'index.adv': '6f5465ed5758fe9c8a2f7ec17b1300f3aa875756c70ff7cba162f7e71bcf88ea',
    },
  },
};
