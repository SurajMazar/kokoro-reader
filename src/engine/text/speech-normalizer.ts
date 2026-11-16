/**
 * Rewrites display text into text that reads well aloud, before the
 * Kokoro-specific normalizer and phonemizer run. Handles the cases that
 * kokoro-js does not: URLs, e-mail addresses, common abbreviations, symbols,
 * ordinals, percentages and very large numbers.
 *
 * This only changes the text that is spoken. Highlighting uses the original
 * sentence offsets, so nothing here needs to preserve length.
 */

const ABBREVIATIONS: [RegExp, string][] = [
  [/\be\.g\.,?/gi, 'for example,'],
  [/\bi\.e\.,?/gi, 'that is,'],
  [/\betc\./gi, 'et cetera'],
  [/\bvs\.?(?=\s)/gi, 'versus'],
  [/\bapprox\./gi, 'approximately'],
  [/\bProf\.(?=\s+[A-Z])/g, 'Professor'],
  [/\bSt\.(?=\s+[A-Z])/g, 'Saint'],
  [/\bNo\.(?=\s*\d)/g, 'number'],
  [/\bFig\.(?=\s*\d)/g, 'figure'],
  [/\bJan\./g, 'January'],
  [/\bFeb\./g, 'February'],
  [/\bAug\./g, 'August'],
  [/\bSept?\./g, 'September'],
  [/\bOct\./g, 'October'],
  [/\bNov\./g, 'November'],
  [/\bDec\./g, 'December'],
];

const SYMBOLS: [RegExp, string][] = [
  [/&/g, ' and '],
  [/(\d)\s*%/g, '$1 percent'],
  [/(\d)\s*°\s*C\b/g, '$1 degrees Celsius'],
  [/(\d)\s*°\s*F\b/g, '$1 degrees Fahrenheit'],
  [/(\d)\s*°/g, '$1 degrees'],
  [/€\s?(\d[\d,.]*)/g, '$1 euros'],
  [/(\d)\s*[x×]\s*(\d)/g, '$1 by $2'],
  [/\s+[-–—]{1,2}\s+/g, ', '],
  [/→/g, ' to '],
  [/[•·▪●]/g, ', '],
  [/[_*#~`^|<>{}[\]\\]+/g, ' '],
];

const ORDINAL_WORDS: Record<string, string> = {
  '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth', '5th': 'fifth', '6th': 'sixth', '7th': 'seventh',
  '8th': 'eighth', '9th': 'ninth', '10th': 'tenth', '11th': 'eleventh', '12th': 'twelfth', '13th': 'thirteenth',
  '20th': 'twentieth', '21st': 'twenty-first', '30th': 'thirtieth', '31st': 'thirty-first',
};

function speakUrl(url: string): string {
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    const host = parsed.hostname.replace(/^www\./, '');
    const parts = host.split('.').join(' dot ');
    const path = parsed.pathname.replace(/\/+$/, '');
    return path && path !== '/' ? `a link to ${parts}` : parts;
  } catch {
    return 'a link';
  }
}

function speakEmail(email: string): string {
  const [user = '', domain = ''] = email.split('@');
  return `${user.replace(/[._-]/g, ' ')} at ${domain.split('.').join(' dot ')}`;
}

function speakLargeNumber(match: string): string {
  const value = Number(match.replace(/,/g, ''));
  if (!Number.isFinite(value)) return match;
  const scales: [number, string][] = [
    [1e12, 'trillion'],
    [1e9, 'billion'],
    [1e6, 'million'],
  ];
  for (const [scale, word] of scales) {
    if (value >= scale && value % (scale / 100) === 0) {
      const scaled = Math.round((value / scale) * 100) / 100;
      return `${scaled} ${word}`;
    }
  }
  return match;
}

export function normalizeForSpeech(text: string): string {
  let out = text.normalize('NFKC');
  out = out.replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, speakEmail);
  out = out.replace(/\bhttps?:\/\/[^\s)]+|\bwww\.[^\s)]+/gi, speakUrl);
  for (const [pattern, replacement] of ABBREVIATIONS) out = out.replace(pattern, replacement);
  out = out.replace(/\b(\d{1,2}(?:st|nd|rd|th))\b/gi, (match) => ORDINAL_WORDS[match.toLowerCase()] ?? match);
  out = out.replace(/\b\d{1,3}(?:,\d{3}){2,}\b|\b\d{7,}\b/g, speakLargeNumber);
  for (const [pattern, replacement] of SYMBOLS) out = out.replace(pattern, replacement);
  return out.replace(/\s{2,}/g, ' ').trim();
}
