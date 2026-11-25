// Interview profiles (Phase 6): one per target role, each with its own knowledge base, vocabulary,
// answer preferences, history and answer cache. Profiles live in the browser; the server only sees
// the small context below with each request.

import { z } from 'zod';

export const ROLES = ['qa_manual', 'qa_automation', 'sdet', 'sre', 'devops', 'cloud', 'networking', 'swe', 'custom'] as const;
export type Role = (typeof ROLES)[number];

export interface AnswerPrefs {
  /** A short natural opener ("So,") and a one-line wrap-up. */
  openers: boolean;
  /** STAR order for behavioral questions (always from verified experience only). */
  star: boolean;
  /** One practical example in technical answers. */
  examples: boolean;
}

export const DEFAULT_PREFS: AnswerPrefs = { openers: true, star: true, examples: true };

export interface Profile {
  id: string;
  name: string;
  role: Role;
  /** Free text, e.g. "Senior". */
  level: string;
  topics: string[];
  /** Canonical spellings for transcription hints (no guessed corrections: hard rule 12). */
  vocabulary: string[];
  prefs: AnswerPrefs;
  createdAt: number;
}

/** The profile existing data is migrated into (Phase 5 had one implicit SRE profile). */
export const DEFAULT_PROFILE_ID = 'default';

interface RoleTemplate {
  label: string;
  topics: string[];
  vocabulary: string[];
}

// Defaults only: every field is editable per profile. Terms are real, widely used names.
export const ROLE_TEMPLATES: Record<Role, RoleTemplate> = {
  qa_manual: {
    label: 'QA Engineer (manual)',
    topics: ['test planning', 'test case design', 'exploratory testing', 'regression testing', 'defect lifecycle', 'requirements analysis', 'API testing basics', 'SQL for testers'],
    vocabulary: ['test plan', 'test case', 'regression testing', 'smoke testing', 'boundary value analysis', 'equivalence partitioning', 'Jira', 'TestRail', 'Postman', 'UAT'],
  },
  qa_automation: {
    label: 'QA Automation Engineer',
    topics: ['test automation frameworks', 'UI automation', 'API automation', 'flaky tests', 'CI integration', 'test data', 'page object model', 'reporting'],
    vocabulary: ['Selenium', 'WebDriver', 'Playwright', 'Cypress', 'Appium', 'TestNG', 'JUnit', 'pytest', 'Page Object Model', 'REST Assured', 'Jenkins', 'GitHub Actions'],
  },
  sdet: {
    label: 'SDET',
    topics: ['test architecture', 'unit and integration testing', 'contract testing', 'mocking', 'performance testing', 'CI/CD quality gates', 'coding', 'test strategy'],
    vocabulary: ['JUnit', 'pytest', 'Mockito', 'Playwright', 'Selenium', 'REST Assured', 'Pact', 'JMeter', 'k6', 'CI/CD', 'code coverage', 'Docker'],
  },
  sre: {
    label: 'Site Reliability Engineer',
    topics: ['SRE', 'DevOps', 'Kubernetes', 'Linux', 'AWS/Azure', 'networking', 'security', 'observability', 'CI/CD', 'databases', 'distributed systems', 'payments'],
    vocabulary: ['SLI', 'SLO', 'SLA', 'error budget', 'p99', 'MTTR', 'postmortem', 'PagerDuty', 'Datadog', 'Prometheus', 'Grafana', 'Kubernetes', 'kubectl', 'Terraform', 'AKS', 'EKS'],
  },
  devops: {
    label: 'DevOps Engineer',
    topics: ['CI/CD', 'infrastructure as code', 'containers', 'Kubernetes', 'release strategies', 'configuration management', 'observability', 'cloud'],
    vocabulary: ['Jenkins', 'GitHub Actions', 'Azure DevOps', 'Terraform', 'Ansible', 'Docker', 'Kubernetes', 'Helm', 'Argo CD', 'blue-green', 'canary'],
  },
  cloud: {
    label: 'Cloud Engineer',
    topics: ['AWS', 'Azure', 'GCP', 'identity and access', 'networking in the cloud', 'cost management', 'high availability', 'infrastructure as code'],
    vocabulary: ['AWS', 'Azure', 'GCP', 'IAM', 'VPC', 'EC2', 'S3', 'EKS', 'AKS', 'Key Vault', 'Route 53', 'CloudWatch', 'Terraform'],
  },
  networking: {
    label: 'Network Engineer',
    topics: ['routing', 'switching', 'BGP', 'OSPF', 'DNS', 'TLS', 'firewalls', 'SD-WAN', 'troubleshooting', 'network automation'],
    vocabulary: ['BGP', 'OSPF', 'EIGRP', 'VLAN', 'MPLS', 'SD-WAN', 'DNS', 'TLS', 'Palo Alto', 'Panorama', 'Wireshark', 'NAT'],
  },
  swe: {
    label: 'Software Engineer',
    topics: ['data structures', 'algorithms', 'system design', 'APIs', 'databases', 'concurrency', 'testing', 'code quality'],
    vocabulary: ['REST', 'gRPC', 'SQL', 'NoSQL', 'hash map', 'binary search', 'dynamic programming', 'microservices', 'Big O', 'concurrency'],
  },
  custom: { label: 'Custom role', topics: [], vocabulary: [] },
};

export function newProfile(role: Role, name: string, id: string, now: number): Profile {
  const t = ROLE_TEMPLATES[role];
  return { id, name: name.trim() || t.label, role, level: '', topics: [...t.topics], vocabulary: [...t.vocabulary], prefs: { ...DEFAULT_PREFS }, createdAt: now };
}

/** What the server receives with each answer request: no KB, history or vocabulary corrections. */
export const profileContextSchema = z.strictObject({
  id: z.string().min(1).max(64),
  role: z.enum(ROLES),
  label: z.string().max(60),
  level: z.string().max(40),
  topics: z.array(z.string().max(40)).max(12),
  prefs: z.strictObject({ openers: z.boolean(), star: z.boolean(), examples: z.boolean() }),
});
export type ProfileContext = z.infer<typeof profileContextSchema>;

export function profileContext(p: Profile): ProfileContext {
  return {
    id: p.id.slice(0, 64),
    role: p.role,
    label: (p.role === 'custom' ? p.name : ROLE_TEMPLATES[p.role].label).slice(0, 60),
    level: p.level.slice(0, 40),
    topics: p.topics.slice(0, 12).map((t) => t.slice(0, 40)),
    prefs: { ...p.prefs },
  };
}

/** "a Senior QA Automation Engineer interview (Selenium, …)", for the prompt's opening line. */
export function domainLine(ctx: ProfileContext): string {
  const role = [ctx.level, ctx.label].filter(Boolean).join(' ');
  return ctx.topics.length ? `${role} (${ctx.topics.join(', ')})` : role;
}

/** Terms sent with session.start for the Whisper prompt; bounded by the message schema. */
export const VOCAB_MAX_TERMS = 60;
export const VOCAB_TERM_CHARS = 40;
