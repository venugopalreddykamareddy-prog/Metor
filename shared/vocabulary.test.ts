import { describe, expect, it } from 'vitest';
import { WHISPER_PROMPT, correctTerms } from './vocabulary.ts';

describe('correctTerms', () => {
  it.each([
    ['run cube cuddle get pods', 'run kubectl get pods'],
    ['we use cooper netties on a k s and e k s', 'we use Kubernetes on AKS and EKS'],
    ['define an s l o and an error budget', 'define an SLO and an error budget'],
    ['p 99 latency went up', 'p99 latency went up'],
    ['b g p and ospf peering', 'BGP and OSPF peering'],
    ['azure front door with key vault', 'Azure Front Door with Key Vault'],
    ['Data Dog and grafana dashboards', 'Datadog and Grafana dashboards'],
    ['deploy with argo cd and terraform', 'deploy with Argo CD and Terraform'],
    ['a vpc in aws', 'a VPC in AWS'],
    ['ci cd pipeline in git hub actions', 'CI/CD pipeline in GitHub Actions'],
  ])('%s', (heard, expected) => {
    expect(correctTerms(heard)).toBe(expected);
  });

  it('leaves ordinary words alone', () => {
    const text = 'The slow service was a simple dns-free test of ideas, and I am on call tonight.';
    expect(correctTerms(text)).toBe('The slow service was a simple DNS-free test of ideas, and I am on-call tonight.');
  });

  it('does not treat contractions as terms', () => {
    expect(correctTerms("it's three o'clock and that's s three")).toBe("it's three o'clock and that's S3");
  });

  it('does not change words that merely contain a term', () => {
    expect(correctTerms('helmet awsome flaws dnssec')).toBe('helmet awsome flaws dnssec');
  });

  it('is idempotent', () => {
    const once = correctTerms('cube cuddle on a k s with b g p');
    expect(correctTerms(once)).toBe(once);
  });
});

describe('WHISPER_PROMPT', () => {
  it('stays short (Groq allows 224 tokens; ~4 chars per token)', () => {
    expect(WHISPER_PROMPT.length).toBeLessThan(224 * 3);
    expect(WHISPER_PROMPT).toContain('kubectl');
  });
});
