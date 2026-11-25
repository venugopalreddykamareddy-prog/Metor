import { describe, expect, it } from 'vitest';
import { termRecall, wordErrorRate, words } from './score.ts';

describe('words', () => {
  it('lowercases, drops punctuation, and keeps CI/CD and on-call intact', () => {
    expect(words('Hello, CI/CD on-call - team!')).toEqual(['hello', 'ci/cd', 'on-call', 'team']);
  });
});

describe('wordErrorRate', () => {
  it('is 0 for a perfect transcript, ignoring case and punctuation', () => {
    expect(wordErrorRate('Run kubectl get pods.', 'run kubectl get pods')).toBe(0);
  });

  it('counts substitutions, deletions, and insertions', () => {
    expect(wordErrorRate('a b c d', 'a x c d')).toBe(0.25); // 1 substitution
    expect(wordErrorRate('a b c d', 'a c d')).toBe(0.25); // 1 deletion
    expect(wordErrorRate('a b c d', 'a b c d e')).toBe(0.25); // 1 insertion
    expect(wordErrorRate('a b', '')).toBe(1);
    expect(wordErrorRate('', '')).toBe(0);
  });
});

describe('termRecall', () => {
  it('lists technical terms found and missed', () => {
    const result = termRecall('Use kubectl on AKS with BGP.', 'use cube cuddle on AKS with BGP');
    expect(result).toEqual({ found: ['AKS', 'BGP'], missed: ['kubectl'] });
  });

  it('finds Terraform next to a hyphen or slash (the term the accuracy check marked missed)', () => {
    for (const hyp of ['We manage EKS with Terraform-managed modules', 'EKS with Terraform/Helm', 'EKS clusters with Terraform-', 'EKS clusters with Terraform, and Argo CD']) {
      expect(termRecall('We manage EKS clusters with Terraform.', hyp).missed, hyp).toEqual([]);
    }
  });

  it('keeps p95/p99 and AKS/EKS distinct', () => {
    expect(termRecall('Alert on p99 latency for AKS.', 'alert on p95 latency for EKS')).toEqual({ found: [], missed: ['p99', 'AKS'] });
    expect(termRecall('p95 and p99 on AKS and EKS', 'p95/p99 on AKS/EKS').missed).toEqual([]);
  });

  it('still counts multi-word and slashed terms', () => {
    expect(termRecall('Deploy with CI/CD and Argo CD.', 'deploy with CI/CD and Argo CD').missed).toEqual([]);
  });
});
