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

  it.each([
    ['we run on as your front door and as your key vault', 'we run on Azure Front Door and Azure Key Vault'],
    ['I reported as your manager asked', 'I reported as your manager asked'],
    ['cube get pods in the namespace', 'kubectl get pods in the namespace'],
    ['a cube of ice', 'a cube of ice'],
    ['define s l i s and s l a s', 'define SLIs and SLAs'],
    ['sli slo and sla', 'SLI SLO and SLA'],
  ])('uses context for ambiguous phrases: %s', (heard, expected) => {
    expect(correctTerms(heard)).toBe(expected);
  });

  it('never guesses unfamiliar terms into known ones', () => {
    for (const text of [
      'we use Kubeflux and Terraformer for that',
      'the service slows down under load',
      'he took the helm of the panorama project',
      'our Datadogger tool and the BGPX protocol',
    ]) {
      expect(correctTerms(text)).toBe(text);
    }
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
  it('stays well under Groq\'s 224-token limit and covers the core domains', () => {
    expect(WHISPER_PROMPT.length).toBeLessThanOrEqual(451);
    for (const term of ['kubectl', 'Kubernetes', 'SLO', 'Terraform', 'Azure', 'BGP', 'OSPF']) expect(WHISPER_PROMPT).toContain(term);
  });
});
