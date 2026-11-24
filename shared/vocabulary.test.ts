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

  it.each([
    ['how would you define an solo for a payments api', 'how would you define an SLO for a payments API'],
    ['what is the difference between an sli and a solo', 'what is the difference between an SLI and a SLO'],
    ['what is a good latency solo for checkout', 'what is a good latency SLO for checkout'],
    ['how do you alert on solo burn rate', 'how do you alert on SLO burn rate'],
    ['we set a solo of 99.9 percent', 'we set a SLO of 99.9 percent'],
    ['solo versus sla what is the difference', 'SLO versus SLA what is the difference'],
    ['how many solos should each service have to protect the error budget', 'how many SLOs should each service have to protect the error budget'],
    ['our solos cover availability and latency', 'our SLOs cover availability and latency'],
    ['what happens when you miss your solo target', 'what happens when you miss your SLO target'],
  ])('reads "solo" as SLO with reliability context: %s', (heard, expected) => {
    expect(correctTerms(heard)).toBe(expected);
  });

  it.each([
    'I worked solo on the error budget tooling',
    'she played a guitar solo at the offsite',
    'it was a solo project about availability',
    'I was flying solo during on-call last week',
    'our solo on-call engineer handled the latency incident',
    'he went solo for a year before joining an SRE team',
    'the solo was the best part of the show',
    'solo travel is fun',
  ])('keeps ordinary "solo": %s', (text) => {
    expect(correctTerms(text)).toBe(text);
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
