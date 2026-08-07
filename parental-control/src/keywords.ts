export type KeywordSeverity = 'low' | 'medium' | 'high';

export interface KeywordEntry {
  keyword: string;
  category: string;
  severity: KeywordSeverity;
  notifyParent: boolean;
  blockSearch: boolean;
}

export const KEYWORD_DATABASE: KeywordEntry[] = [
  // Adult / Pornography
  { keyword: 'porn', category: 'Adult / Pornography', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'pornhub', category: 'Adult / Pornography', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'xvideos', category: 'Adult / Pornography', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'xnxx', category: 'Adult / Pornography', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'redtube', category: 'Adult / Pornography', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'youporn', category: 'Adult / Pornography', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'xxx', category: 'Adult / Pornography', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'nsfw', category: 'Adult / Pornography', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'adult video', category: 'Adult / Pornography', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'sex video', category: 'Adult / Pornography', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'free porn', category: 'Adult / Pornography', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'porno', category: 'Adult / Pornography', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'erotic', category: 'Adult / Pornography', severity: 'medium', notifyParent: true, blockSearch: false },
  { keyword: 'naked', category: 'Adult / Pornography', severity: 'medium', notifyParent: true, blockSearch: false },

  // Sexual Content
  { keyword: 'masturbation', category: 'Sexual Content', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'orgasm', category: 'Sexual Content', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'blowjob', category: 'Sexual Content', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'anal sex', category: 'Sexual Content', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'oral sex', category: 'Sexual Content', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'threesome', category: 'Sexual Content', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'gangbang', category: 'Sexual Content', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'bukkake', category: 'Sexual Content', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'creampie', category: 'Sexual Content', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'cumshot', category: 'Sexual Content', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'deepthroat', category: 'Sexual Content', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'handjob', category: 'Sexual Content', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'fingering', category: 'Sexual Content', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'lesbian sex', category: 'Sexual Content', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'gay porn', category: 'Sexual Content', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'trans porn', category: 'Sexual Content', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'hentai', category: 'Sexual Content', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'rule34', category: 'Sexual Content', severity: 'high', notifyParent: true, blockSearch: true },

  // Gambling
  { keyword: '1xbet', category: 'Gambling', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'bet365', category: 'Gambling', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'parimatch', category: 'Gambling', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'melbet', category: 'Gambling', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'mostbet', category: 'Gambling', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'ggbet', category: 'Gambling', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'pin-up', category: 'Gambling', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'vulkan', category: 'Gambling', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'casino', category: 'Gambling', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'online casino', category: 'Gambling', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'slot machine', category: 'Gambling', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'poker', category: 'Gambling', severity: 'medium', notifyParent: true, blockSearch: false },
  { keyword: 'betting', category: 'Gambling', severity: 'medium', notifyParent: true, blockSearch: false },
  { keyword: 'sports betting', category: 'Gambling', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'bookmaker', category: 'Gambling', severity: 'medium', notifyParent: true, blockSearch: false },
  { keyword: 'jackpot', category: 'Gambling', severity: 'medium', notifyParent: true, blockSearch: false },
  { keyword: 'lottery', category: 'Gambling', severity: 'medium', notifyParent: true, blockSearch: false },
  { keyword: 'gamble', category: 'Gambling', severity: 'medium', notifyParent: true, blockSearch: false },

  // Drugs
  { keyword: 'cocaine', category: 'Drugs', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'heroin', category: 'Drugs', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'methamphetamine', category: 'Drugs', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'meth', category: 'Drugs', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'mdma', category: 'Drugs', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'ecstasy', category: 'Drugs', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'lsd', category: 'Drugs', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'marijuana', category: 'Drugs', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'weed', category: 'Drugs', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'cannabis', category: 'Drugs', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'hashish', category: 'Drugs', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'buy drugs', category: 'Drugs', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'drug dealer', category: 'Drugs', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'darknet market', category: 'Drugs', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'opioid', category: 'Drugs', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'fentanyl', category: 'Drugs', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'xanax', category: 'Drugs', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'adderall', category: 'Drugs', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'steroids', category: 'Drugs', severity: 'high', notifyParent: true, blockSearch: true },

  // Violence
  { keyword: 'how to kill', category: 'Violence', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'murder', category: 'Violence', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'suicide', category: 'Violence', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'self harm', category: 'Violence', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'cutting myself', category: 'Violence', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'violent video', category: 'Violence', severity: 'medium', notifyParent: true, blockSearch: false },
  { keyword: 'gore', category: 'Violence', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'beheading', category: 'Violence', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'torture', category: 'Violence', severity: 'high', notifyParent: true, blockSearch: true },

  // Self-harm
  { keyword: 'suicide methods', category: 'Self-harm', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'kill myself', category: 'Self-harm', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'end my life', category: 'Self-harm', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'want to die', category: 'Self-harm', severity: 'high', notifyParent: true, blockSearch: true },
  { keyword: 'overdose', category: 'Self-harm', severity: 'high', notifyParent: true, blockSearch: true },
];

export function getKeywordsByCategory(category: string): KeywordEntry[] {
  return KEYWORD_DATABASE.filter(k => k.category === category);
}

export function getAllCategories(): string[] {
  return [...new Set(KEYWORD_DATABASE.map(k => k.category))];
}

export function findMatchingKeywords(query: string): KeywordEntry[] {
  const lowerQuery = query.toLowerCase();
  return KEYWORD_DATABASE.filter(entry => 
    lowerQuery.includes(entry.keyword.toLowerCase())
  );
}

export function analyzeSearchQuery(query: string): {
  matched: KeywordEntry[];
  highestSeverity: KeywordSeverity;
  shouldNotify: boolean;
  shouldBlock: boolean;
  categories: string[];
} {
  const matched = findMatchingKeywords(query);
  
  if (matched.length === 0) {
    return {
      matched: [],
      highestSeverity: 'low',
      shouldNotify: false,
      shouldBlock: false,
      categories: []
    };
  }

  const severityOrder: KeywordSeverity[] = ['high', 'medium', 'low'];
  const highestSeverity = matched.reduce((highest, entry) => 
    severityOrder.indexOf(entry.severity) < severityOrder.indexOf(highest) 
      ? entry.severity 
      : highest, 
    'low'
  );

  const shouldNotify = matched.some(entry => entry.notifyParent);
  const shouldBlock = matched.some(entry => entry.blockSearch);
  const categories = [...new Set(matched.map(entry => entry.category))];

  return {
    matched,
    highestSeverity,
    shouldNotify,
    shouldBlock,
    categories
  };
}