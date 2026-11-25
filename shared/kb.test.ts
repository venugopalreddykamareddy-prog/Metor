import { describe, expect, it } from 'vitest';
import { unsupportedClaims } from './experienceClaims.ts';
import { chunks, isBehavioral, isProfileQuestion, keywords, retrieve, snippetLabel, type KbItem } from './kb.ts';
import { parseClientMessage } from './messages.ts';

let n = 0;
const item = (kind: KbItem['kind'], title: string, text: string, extra: Partial<KbItem> = {}): KbItem => ({
  id: `i${n++}`,
  kind,
  provenance: 'verified',
  title,
  text,
  active: true,
  updatedAt: 0,
  ...extra,
});

const resume = item(
  'resume',
  'Resume 2026',
  [
    'Senior SRE, Contoso Payments, 2021–2026',
    '- Ran 40 AKS clusters across two regions; cut p99 checkout latency from 900 ms to 300 ms.',
    '- Built Terraform modules for Azure Front Door and Key Vault.',
    '',
    'Network Engineer, Fabrikam, 2017–2021',
    '- Migrated 120 branches to SD-WAN on Palo Alto firewalls managed by Panorama.',
    '- Ran BGP with two ISPs and tuned local preference for failover.',
    '',
    'Education: BSc Computer Science. Hobbies: cycling, chess, photography and cooking for friends on weekends.',
    'Certifications: CKA, AZ-104. Languages: English, Telugu, Hindi. References available on request for all roles above.',
  ].join('\n'),
);
const story = item('story', 'Checkout outage', 'A bad config push took checkout down for 20 minutes. I rolled back with Argo CD, then added a canary step.');
const term = item('term', 'Shipyard', 'Internal deploy tool that wraps Argo CD.');
const old = item('resume', 'Old resume', 'Ran Kubernetes clusters on bare metal.', { active: false });
const items = [resume, story, term, old];

describe('keywords', () => {
  it('drops stop words and plurals, keeps technical tokens', () => {
    expect(keywords('How would you tune the BGP sessions for p99 and CI/CD?')).toEqual(['tune', 'bgp', 'session', 'p99', 'ci/cd']);
  });
});

describe('chunks', () => {
  it('keeps short items whole and splits a long resume at bullets and paragraphs', () => {
    expect(chunks(story)).toEqual([story.text]);
    const parts = chunks(resume);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 700)).toBe(true);
  });
});

describe('retrieve', () => {
  it('sends only the relevant excerpts, never the whole resume', () => {
    const got = retrieve(items, 'How did you run BGP with two ISPs?');
    expect(got[0]?.text).toContain('BGP with two ISPs');
    expect(got.map((s) => s.text).join(' ')).not.toContain('Hobbies');
    expect(got.reduce((sum, s) => sum + s.text.length, 0)).toBeLessThan(resume.text.length);
  });

  it('brings internal terms named in the question and skips inactive items', () => {
    const got = retrieve(items, 'How does Shipyard deploy to Kubernetes clusters?');
    expect(got.some((s) => s.kind === 'term' && s.title === 'Shipyard')).toBe(true);
    expect(got.some((s) => s.title === 'Old resume')).toBe(false);
  });

  it('returns nothing for an unrelated question and respects the limits', () => {
    expect(retrieve(items, 'What is the capital of France?')).toEqual([]);
    expect(retrieve(items, 'AKS Terraform BGP Argo CD SD-WAN', { max: 2 })).toHaveLength(2);
    expect(retrieve(items, 'AKS Terraform BGP Argo CD SD-WAN', { maxChars: 150 }).every((s) => s.text.length <= 150)).toBe(true);
  });
});

describe('isBehavioral', () => {
  it.each(['Tell me about a time you handled an outage', 'so describe a situation where you disagreed', 'Have you ever led an incident?', 'What did you do the last time a deploy failed, a time when it hurt?'])(
    'detects "%s"',
    (q) => expect(isBehavioral(q)).toBe(true),
  );
  it.each(['How does BGP choose a path?', 'Explain the time complexity of a heap'])('ignores "%s"', (q) => expect(isBehavioral(q)).toBe(false));
});

describe('snippetLabel', () => {
  it('labels provenance only for items about the candidate', () => {
    expect(snippetLabel({ kind: 'story', provenance: 'verified' })).toBe('[verified story]');
    expect(snippetLabel({ kind: 'term', provenance: 'verified' })).toBe('[internal term]');
    expect(snippetLabel({ kind: 'job', provenance: 'hypothetical' })).toBe('[job description]');
  });
});

describe('unsupportedClaims', () => {
  it('accepts claims backed by a verified excerpt and flags invented ones', () => {
    const verified = [story.text];
    expect(unsupportedClaims(['I rolled back the checkout config with Argo CD.'], verified)).toEqual([]);
    expect(unsupportedClaims(["I've migrated 10,000-node clusters to GKE."], verified)).toHaveLength(1);
  });
});

describe('answer.request kb field', () => {
  const req = { type: 'answer.request', id: 'r', ts: 1, questionId: 'q', question: 'How?', length: 'short', engine: 'simulated', statements: [], turns: [], isFollowUp: false };
  it('accepts a few excerpts and rejects oversized or unknown ones', () => {
    const kb = [{ kind: 'story', provenance: 'verified', title: 'T', text: 'x' }];
    expect(parseClientMessage(JSON.stringify({ ...req, kb })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ ...req, kb: Array(7).fill(kb[0]) })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ ...req, kb: [{ ...kb[0], text: 'x'.repeat(701) }] })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ ...req, kb: [{ ...kb[0], provenance: 'trusted' }] })).ok).toBe(false);
  });
});

describe('long paragraphs (review finding 4)', () => {
  const sentence = (i: number) => `In role ${i} I ran ${i * 10} AKS clusters and wrote Terraform module number ${i} for networking.`;
  const long = item('resume', 'One-line resume', Array.from({ length: 30 }, (_, i) => sentence(i + 1)).join(' '));

  it('splits a long line into chunks without losing any text', () => {
    const parts = chunks(long);
    expect(parts.length).toBeGreaterThan(3);
    expect(parts.every((p) => p.length <= 350)).toBe(true);
    expect(parts.join(' ').replace(/\s+/g, ' ')).toBe(long.text);
  });

  it('finds a fact from the end of a long paragraph', () => {
    const got = retrieve([long], 'Tell me about Terraform module number 29');
    expect(got.map((s) => s.text).join(' ')).toContain('module number 29');
  });

  it('splits an unbroken token longer than a chunk instead of cutting it', () => {
    const blob = item('reference', 'Blob', 'x'.repeat(900));
    expect(chunks(blob).join('')).toBe('x'.repeat(900));
  });
});

describe('profile questions (review finding 6)', () => {
  it.each(['Tell me about yourself.', 'Can you walk me through your background?', "What's your experience?", 'Give me a quick summary — describe your career so far', 'What is your current role?'])(
    'detects "%s"',
    (q) => expect(isProfileQuestion(q)).toBe(true),
  );
  it.each(['How does BGP choose a path?', 'Tell me about a time you failed'])('ignores "%s"', (q) => expect(isProfileQuestion(q)).toBe(false));

  it('retrieves the start of the verified resume without a keyword match, within the limits', () => {
    const got = retrieve(items, 'Tell me about yourself');
    expect(got[0]?.title).toBe('Resume 2026');
    expect(got[0]?.text).toContain('Senior SRE, Contoso Payments');
    expect(got.length).toBeLessThanOrEqual(5);
    expect(got.some((s) => s.title === 'Old resume')).toBe(false); // inactive stays out
  });

  it('never pulls in an unverified resume for a profile question', () => {
    const draft = item('resume', 'Draft', 'Principal engineer at a big company.', { provenance: 'hypothetical' });
    expect(retrieve([draft], 'Tell me about yourself')).toEqual([]);
  });
});

