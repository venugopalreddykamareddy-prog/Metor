import { describe, expect, it } from 'vitest';
import { findExperienceClaims } from './experienceClaims.ts';

describe('findExperienceClaims', () => {
  it.each([
    "If you’re talking about active‑active HA, I’ve built services that run across two availability zones.",
    "I've integrated several internal apps using its OpenID Connect flow.",
    'At my last company we ran 10,000 nodes.',
    'Yes, I have managed clusters that size.',
    'When I was at a fintech, we migrated to Kubernetes.',
    'I led the incident response for a payments outage.',
    'We migrated the monolith in six months.',
    'In my experience, canaries catch most regressions.',
    'I have 8 years of experience with BGP.',
  ])('flags a claimed experience: %s', (text) => {
    expect(findExperienceClaims(text)).toHaveLength(1);
  });

  it.each([
    "I'd start by checking the pod events with kubectl describe.",
    'I would add an idempotency key at the edge.',
    "Say checkout latency doubles after a deploy: I'd compare traces first.",
    "There's no verified story loaded yet. One way I'd approach it: I built a timeline first.",
    'Teams usually run two availability zones.',
    'If you mean Azure AD, the usual setup is OpenID Connect with group-based access.',
    'We can set up a canary with 5% of traffic.',
  ])('allows hypotheticals and general statements: %s', (text) => {
    expect(findExperienceClaims(text)).toEqual([]);
  });
});
