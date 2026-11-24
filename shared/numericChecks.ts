// Local checks of availability numbers in an answer (no extra request). Two general rules:
//  1. Direction: a higher availability percentage is stricter (less allowed downtime). "A is
//     tighter than B" must mean A% > B%, whether A and B are percentages or SLA/SLO targets the
//     answer gave numbers to.
//  2. Arithmetic: "99.9% … about 43 minutes per month" must match (1 − availability) × period.
// Only availability-like values (90–99.999…%) count, so CPU or error-rate percentages are ignored.

const PCT = String.raw`(9\d(?:\.\d+)?)\s?(?:%|percent\b)`;
const LABEL = String.raw`SLA|SLO`;
const STRICTER = ['tighter', 'stricter', 'higher', 'more demanding', 'more aggressive'];
const LOOSER = ['looser', 'lower', 'less strict', 'more lenient', 'more relaxed'];
const COMPARATIVE = [...STRICTER, ...LOOSER].join('|');
const SIDE = String.raw`(?:(?:the|our|that|an?|internal|external)\s+)*(${LABEL}|9\d(?:\.\d+)?\s?(?:%|percent))`;

const PERIOD_MINUTES: Record<string, [number, number]> = {
  day: [1440, 1440],
  week: [10_080, 10_080],
  // 30 days or an average month (30.44 days); both are common.
  month: [43_200, 43_830],
  quarter: [129_600, 131_490],
  year: [525_600, 525_960],
};
const UNIT_MINUTES: Record<string, number> = { second: 1 / 60, minute: 1, hour: 60, day: 1440 };

function sentencesOf(text: string): string[] {
  return text.replace(/’/g, "'").split(/(?<=[.!?])\s+/);
}

const pctValue = (s: string) => Number(/9\d(?:\.\d+)?/.exec(s)?.[0]);

/** SLA/SLO → availability the answer gave it ("set the SLO to 99.95%", "…99.95%. That becomes the SLO"). */
function bindTargets(sentences: string[]): Map<string, number> {
  const bound = new Map<string, number>();
  sentences.forEach((s, i) => {
    const pcts = [...s.matchAll(new RegExp(PCT, 'gi'))];
    const label = new RegExp(String.raw`\b(${LABEL})\b`).exec(s)?.[1];
    if (!label || bound.has(label)) return;
    if (pcts.length >= 1) {
      bound.set(label, Number(pcts[0]?.[1]));
    } else if (/^(?:that|this|which)\s+(?:becomes|is|will be|would be)\b/i.test(s.trim())) {
      // "That becomes the SLO": the number is in the previous sentence.
      const prev = [...(sentences[i - 1] ?? '').matchAll(new RegExp(PCT, 'gi'))].at(-1);
      if (prev) bound.set(label, Number(prev[1]));
    }
  });
  return bound;
}

export interface NumericIssue {
  kind: 'availability_direction' | 'downtime_arithmetic';
  message: string;
}

export function checkAvailabilityNumbers(text: string): NumericIssue[] {
  const sentences = sentencesOf(text);
  const targets = bindTargets(sentences);
  const issues: NumericIssue[] = [];
  const value = (side: string) => (/^(SLA|SLO)$/.test(side) ? targets.get(side) : pctValue(side));

  for (const s of sentences) {
    const compare = new RegExp(String.raw`${SIDE}[^.;!?]*?\b(${COMPARATIVE})(?:\s+(?:target|goal|bar|level|availability))?\s+than\s+${SIDE}`, 'gi');
    for (const m of s.matchAll(compare)) {
      const [, left = '', word = '', right = ''] = m;
      const a = value(left.replace(/\s/g, ''));
      const b = value(right.replace(/\s/g, ''));
      if (a === undefined || b === undefined || Number.isNaN(a) || Number.isNaN(b) || a === b) continue;
      const saysStricter = STRICTER.includes(word.toLowerCase());
      if (saysStricter !== a > b) {
        const name = (side: string, v: number) => (/^(SLA|SLO)$/.test(side.trim()) ? `${side.trim()} (${v}%)` : `${v}%`);
        issues.push({
          kind: 'availability_direction',
          message: `Says ${name(left, a)} is ${word} than ${name(right, b)}, but ${Math.max(a, b)}% is the stricter target (less downtime).`,
        });
      }
    }

    const pcts = [...s.matchAll(new RegExp(PCT, 'gi'))];
    const duration = /\b(?:about|around|roughly|approximately|~|just under|just over)?\s*(\d+(?:\.\d+)?)\s*(second|minute|min|hour|hr|day)s?\b/i.exec(s);
    const period = /\b(?:per|a|each|every|over a|in a)\s+(day|week|month|quarter|year)\b|\b(daily|weekly|monthly|quarterly|yearly|annually)\b/i.exec(s);
    if (pcts.length === 1 && duration && period) {
      const availability = Number(pcts[0]?.[1]);
      const unit = (duration[2] ?? '').toLowerCase().replace(/^min$/, 'minute').replace(/^hr$/, 'hour');
      const claimed = Number(duration[1]) * (UNIT_MINUTES[unit] ?? Number.NaN);
      const p = (period[1] ?? period[2] ?? '').toLowerCase().replace(/ly$/, '').replace(/^dai$/, 'day').replace(/^annual$/, 'year');
      const range = PERIOD_MINUTES[p];
      if (!range || Number.isNaN(claimed) || availability >= 100) continue;
      const [lo, hi] = range.map((m) => (m * (100 - availability)) / 100) as [number, number];
      if (claimed < lo * 0.75 || claimed > hi * 1.25) {
        const fmt = (m: number) => (m >= 120 ? `${(m / 60).toFixed(1)} hours` : m >= 1 ? `${m.toFixed(1)} minutes` : `${(m * 60).toFixed(0)} seconds`);
        issues.push({
          kind: 'downtime_arithmetic',
          message: `${availability}% allows about ${fmt(lo)} of downtime per ${p}, not ${duration[1]} ${duration[2]}${Number(duration[1]) === 1 ? '' : 's'}.`,
        });
      }
    }
  }
  return issues;
}
