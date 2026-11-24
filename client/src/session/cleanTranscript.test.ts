import { describe, expect, it } from 'vitest';
import { buildCleanTranscript, cleanSentence, cleanTranscriptText, looksLikeQuestion, type CleanItem } from './cleanTranscript.ts';
import type { TranscriptLine } from './transcript.ts';

let seq = 0;
/** A raw fragment heard from startMs to endMs. */
const frag = (text: string, startMs: number, endMs: number): TranscriptLine => {
  seq += 1;
  return { kind: 'final', key: `f${seq}`, finalSeq: seq, text, startMs, endMs };
};
const texts = (items: CleanItem[]) => items.map((i) => (i.kind === 'sentence' ? i.text : `[gap ${i.seconds}s]`));

describe('cleanSentence', () => {
  it.each([
    ['how would you define an slo', 'How would you define an SLO?'],
    ['so what happens when a pod crashes', 'So what happens when a pod crashes?'],
    ['tell me about a time you handled an outage', 'Tell me about a time you handled an outage.'],
    ['walk me through b g p path selection', 'Walk me through BGP path selection.'],
    ['i think i would check the dashboards first', 'I think I would check the dashboards first.'],
    ["i'm on call this week", "I'm on-call this week."],
    ['kubectl rollout undo fixes it', 'kubectl rollout undo fixes it.'],
  ])('punctuates and capitalizes: %s', (raw, expected) => {
    expect(cleanSentence(raw)).toBe(expected);
  });

  it('removes fillers but keeps words that carry meaning', () => {
    expect(cleanSentence('um so uh we used, like, terraform hmm for that')).toBe('So we used, like, Terraform for that.');
  });

  it('collapses stuttered repeats but keeps normal doubled words', () => {
    expect(cleanSentence('what is what is the the error budget')).toBe('What is the error budget?');
    expect(cleanSentence('i know that that was very very slow')).toBe('I know that that was very very slow.');
  });

  it('marks a cut-off sentence with an ellipsis instead of inventing an ending', () => {
    expect(cleanSentence('we moved the cluster to eks because')).toBe('We moved the cluster to EKS because…');
  });

  it('leaves the last sentence unpunctuated while speech is still coming', () => {
    expect(cleanSentence('how does ospf', [], true)).toBe('How does OSPF');
  });

  it('keeps punctuation the recognizer already added', () => {
    expect(cleanSentence('Is it DNS? It is always DNS!')).toBe('Is it DNS? It is always DNS!');
  });

  it("applies the user's corrections as whole words", () => {
    const fixes = [{ heard: 'cloud flair', correct: 'Cloudflare' }, { heard: 'argo', correct: 'Argo' }];
    expect(cleanSentence('we put cloud flair in front of argonaut and argo', fixes)).toBe(
      'We put Cloudflare in front of argonaut and Argo.',
    );
  });

  it('does not turn unfamiliar terms into known ones', () => {
    expect(cleanSentence('have you used kubeflux or terraformer')).toBe('Have you used kubeflux or terraformer?');
  });
});

describe('looksLikeQuestion', () => {
  it('looks past lead-in words and treats requests as statements', () => {
    expect(looksLikeQuestion('okay so how would you scale it')).toBe(true);
    expect(looksLikeQuestion('describe your on-call process')).toBe(false);
  });
});

describe('buildCleanTranscript', () => {
  it('joins fragments split by short pauses into one sentence', () => {
    const lines = [frag('how would you', 0, 800), frag('define an slo for', 1300, 2200), frag('a payments api', 2600, 3400)];
    expect(texts(buildCleanTranscript(lines))).toEqual(['How would you define an SLO for a payments API?']);
  });

  it('starts a new sentence after a long pause', () => {
    const lines = [frag('we used datadog', 0, 1000), frag('the alerts were noisy', 3000, 4000)];
    expect(texts(buildCleanTranscript(lines))).toEqual(['We used Datadog.', 'The alerts were noisy.']);
  });

  it('keeps question boundaries even after a short pause', () => {
    const lines = [frag('that makes sense', 0, 1000), frag('what about ospf', 1700, 2500)];
    expect(texts(buildCleanTranscript(lines))).toEqual(['That makes sense.', 'What about OSPF?']);
    expect(buildCleanTranscript(lines).map((i) => i.kind === 'sentence' && i.isQuestion)).toEqual([false, true]);
  });

  it('splits two questions asked in one breath when the recognizer punctuates them', () => {
    const lines = [frag('What is an SLI? How is it different from an SLO?', 0, 4000)];
    expect(texts(buildCleanTranscript(lines))).toEqual(['What is an SLI?', 'How is it different from an SLO?']);
  });

  it('drops a fragment the recognizer repeated after a restart', () => {
    const lines = [frag('check the bgp peers', 0, 1500), frag('Check the BGP peers.', 1600, 2000), frag('then the routes', 4000, 5000)];
    expect(texts(buildCleanTranscript(lines))).toEqual(['Check the BGP peers.', 'Then the routes.']);
  });

  it('ends a sentence at an audio gap and shows the gap', () => {
    const lines: TranscriptLine[] = [
      frag('the cluster went down because', 0, 900),
      { kind: 'gap', key: 'g1', seconds: 2 },
      frag('back up', 1000, 1500),
    ];
    expect(texts(buildCleanTranscript(lines))).toEqual(['The cluster went down because…', '[gap 2s]', 'Back up.']);
  });

  it('leaves the last sentence open while a partial is showing', () => {
    const items = buildCleanTranscript([frag('how would you scale', 0, 900)], { lastIsOpen: true });
    expect(items[0]).toMatchObject({ text: 'How would you scale', open: true });
  });

  it('uses hand edits for a sentence and keeps its raw text', () => {
    const lines = [frag('we run on as you are', 0, 1000)];
    const key = buildCleanTranscript(lines)[0]?.key ?? '';
    const items = buildCleanTranscript(lines, { overrides: { [key]: 'We run on Azure.' } });
    expect(items[0]).toMatchObject({ text: 'We run on Azure.', raw: 'we run on as you are', edited: true });
  });

  it('cleanTranscriptText joins sentences for scoring', () => {
    const lines = [frag('um what is', 0, 500), frag('an s l a', 800, 1400)];
    expect(cleanTranscriptText(buildCleanTranscript(lines))).toBe('What is an SLA?');
  });
});
