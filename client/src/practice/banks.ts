import type { Role } from '../../../shared/profile.ts';
import type { PracticeQuestion } from '../profile/profiles.ts';

// Drafted question banks for owner review (Phase 6). Questions only, no model answers. Misleading
// questions rest on a false premise about well-established facts; made-up ones use coined names
// that aren't real features. `expect` says what a good answer notices. Every bank is copied into the
// profile's local store, where it can be edited.

type Draft = Pick<PracticeQuestion, 'category' | 'text' | 'expect'>;

const BEHAVIORAL_COMMON: Draft[] = [
  { category: 'behavioral', text: 'Tell me about yourself.' },
  { category: 'behavioral', text: 'Tell me about a time you disagreed with a teammate and how it was resolved.' },
];

export const BANKS: Record<Role, Draft[]> = {
  qa_manual: [
    { category: 'technical', text: "What's the difference between smoke testing and regression testing?" },
    { category: 'technical', text: 'How would you use boundary value analysis for an age field that accepts 18 to 65?' },
    { category: 'behavioral', text: 'Tell me about a time you found a critical bug late in a release.' },
    { category: 'scenario', text: "A release is due tomorrow and testing isn't finished. What do you do?" },
    { category: 'troubleshooting', text: 'A bug reproduces for users but never on your machine. How do you narrow it down?' },
    { category: 'follow_up', text: 'And how would you decide which of those tests to automate first?' },
    { category: 'misleading', text: "Since exploratory testing doesn't need any planning, how do you report its coverage?", expect: 'Exploratory testing is still planned (charters, time boxes); correct the premise politely.' },
    { category: 'made_up', text: 'How do you configure Zorblex coverage gates in TestRail?', expect: 'Not a known TestRail feature: say so and ask what it refers to.' },
    ...BEHAVIORAL_COMMON,
  ],
  qa_automation: [
    { category: 'technical', text: 'How does the Page Object Model help keep UI tests maintainable?' },
    { category: 'technical', text: 'When would you use explicit waits instead of fixed sleeps in Selenium?' },
    { category: 'behavioral', text: 'Tell me about a time you reduced flaky tests in a suite.' },
    { category: 'scenario', text: 'Your UI suite takes two hours in CI. How would you get feedback faster?' },
    { category: 'troubleshooting', text: 'A Playwright test passes locally but fails in CI. What do you check?' },
    { category: 'follow_up', text: 'How would you report those results to the team?' },
    { category: 'misleading', text: 'Since Selenium can only drive Chrome, how do you test Firefox?', expect: 'Selenium WebDriver supports several browsers, Firefox included; correct the premise.' },
    { category: 'made_up', text: 'How do you enable Cypress Quantleaf retries?', expect: 'Not a known Cypress feature: say so and ask what it refers to.' },
    ...BEHAVIORAL_COMMON,
  ],
  sdet: [
    { category: 'technical', text: "What's the difference between a mock and a stub?" },
    { category: 'technical', text: 'What is contract testing, and when is it useful?' },
    { category: 'behavioral', text: 'Tell me about a time you pushed for better test coverage.' },
    { category: 'scenario', text: 'A team wants 100% code coverage before every merge. How do you respond?' },
    { category: 'troubleshooting', text: 'Integration tests fail at random when run in parallel. How do you find the cause?' },
    { category: 'follow_up', text: 'Which of those would you fix first, and why?' },
    { category: 'misleading', text: 'Since unit tests always hit the real database, how do you keep them fast?', expect: 'Unit tests usually isolate the code from real databases; correct the premise.' },
    { category: 'made_up', text: 'How do you tune JUnit Vortane parallelism?', expect: 'Not a known JUnit feature: say so and ask what it refers to.' },
    ...BEHAVIORAL_COMMON,
  ],
  sre: [
    { category: 'technical', text: 'How would you define an SLO and an error budget for a payments API?' },
    { category: 'technical', text: "What does p99 latency tell you that the average doesn't?" },
    { category: 'behavioral', text: 'Tell me about a time you led an incident response.' },
    { category: 'scenario', text: 'Your error budget is spent halfway through the month. What changes?' },
    { category: 'troubleshooting', text: 'Latency spikes every hour on the hour. How do you investigate?' },
    { category: 'follow_up', text: 'How would you alert on that without paging for every blip?' },
    { category: 'misleading', text: 'Since a 99.9% monthly SLO allows about four hours of downtime, how do you plan maintenance?', expect: '99.9% over 30 days allows about 43 minutes, not four hours; correct the number.' },
    { category: 'made_up', text: 'How do you configure Prometheus Driftmesh rules?', expect: 'Not a known Prometheus feature: say so and ask what it refers to.' },
    ...BEHAVIORAL_COMMON,
  ],
  devops: [
    { category: 'technical', text: "What's the difference between blue-green and canary deployments?" },
    { category: 'technical', text: 'Why keep Terraform state remote, and why does it need locking?' },
    { category: 'behavioral', text: 'Tell me about a time a deployment failed and how you recovered.' },
    { category: 'scenario', text: 'Developers wait 40 minutes for CI on every change. How would you speed it up?' },
    { category: 'troubleshooting', text: 'A Kubernetes pod is stuck in CrashLoopBackOff. What do you check?' },
    { category: 'follow_up', text: 'How would you stop that from happening again?' },
    { category: 'misleading', text: 'Since each Docker container runs its own kernel, how do you patch kernels per container?', expect: 'Containers share the host kernel; correct the premise.' },
    { category: 'made_up', text: 'How do you enable Jenkins Pellucid pipelines?', expect: 'Not a known Jenkins feature: say so and ask what it refers to.' },
    ...BEHAVIORAL_COMMON,
  ],
  cloud: [
    { category: 'technical', text: 'How do IAM roles differ from IAM users in AWS?' },
    { category: 'technical', text: 'How would you design a VPC with public and private subnets?' },
    { category: 'behavioral', text: 'Tell me about a time you reduced cloud costs.' },
    { category: 'scenario', text: 'A service must survive the loss of one availability zone. What do you change?' },
    { category: 'troubleshooting', text: "An EC2 instance in a private subnet can't reach the internet. What do you check?" },
    { category: 'follow_up', text: 'How would you do the same in Azure?' },
    { category: 'misleading', text: 'Since all availability zones in a region share one data center, how do you get real redundancy?', expect: 'Availability zones are physically separate data centers; correct the premise.' },
    { category: 'made_up', text: 'How do you configure Azure Lumora gateways?', expect: 'Not a known Azure service: say so and ask what it refers to.' },
    ...BEHAVIORAL_COMMON,
  ],
  networking: [
    { category: 'technical', text: 'How does BGP choose the best path?' },
    { category: 'technical', text: "What's the difference between TCP and UDP, and when would you pick UDP?" },
    { category: 'behavioral', text: 'Tell me about a time you resolved a major network outage.' },
    { category: 'scenario', text: "You're migrating 100 branches to SD-WAN. How do you plan the rollout?" },
    { category: 'troubleshooting', text: 'Ping works, but HTTPS connections time out. How do you troubleshoot?' },
    { category: 'follow_up', text: 'What would you capture in Wireshark to confirm it?' },
    { category: 'misleading', text: 'Since TCP is connectionless, how does it guarantee delivery?', expect: 'TCP is connection-oriented; correct the premise, then explain acknowledgements and retransmission.' },
    { category: 'made_up', text: 'How do you tune OSPF Quillon timers?', expect: 'Not a known OSPF timer: say so and ask what it refers to.' },
    ...BEHAVIORAL_COMMON,
  ],
  swe: [
    { category: 'technical', text: 'When would you choose a hash map over a sorted array?' },
    { category: 'technical', text: "How would you design a URL shortener's API?" },
    { category: 'behavioral', text: 'Tell me about a time you disagreed with a design decision.' },
    { category: 'scenario', text: 'A service you own slows down under load. How do you approach it?' },
    { category: 'troubleshooting', text: 'A test fails only when run together with other tests. What could cause that?' },
    { category: 'follow_up', text: "What's the time complexity of your approach?" },
    { category: 'misleading', text: 'Since binary search works on any array, how do you apply it to unsorted data?', expect: 'Binary search needs sorted data; correct the premise.' },
    { category: 'made_up', text: "How do you use Python's Zentric decorators for caching?", expect: 'Not a known Python feature: say so and ask what it refers to.' },
    ...BEHAVIORAL_COMMON,
  ],
  custom: [
    ...BEHAVIORAL_COMMON,
    { category: 'behavioral', text: 'Tell me about a time you had to learn something new quickly.' },
    { category: 'scenario', text: 'How would you spend your first 90 days in this role?' },
    { category: 'follow_up', text: 'Can you give a concrete example of that?' },
  ],
};

/** The drafted bank for a role, as editable questions owned by one profile. */
export function seedQuestions(role: Role, profileId: string, newId: () => string): PracticeQuestion[] {
  return BANKS[role].map((d) => ({ ...d, id: newId(), profileId, source: 'bank' as const }));
}

export interface Scores {
  accuracy: number;
  relevance: number;
  communication: number;
  completeness: number;
}

/** Reads the SCORES line of practice feedback; null when it's missing or malformed. */
export function parseScores(text: string): Scores | null {
  const m = /SCORES:\s*accuracy\s*=\s*([1-5])\s+relevance\s*=\s*([1-5])\s+communication\s*=\s*([1-5])\s+completeness\s*=\s*([1-5])/i.exec(text);
  return m ? { accuracy: Number(m[1]), relevance: Number(m[2]), communication: Number(m[3]), completeness: Number(m[4]) } : null;
}

/** Averages per rubric area across this session's feedback, weakest first. */
export function weakestAreas(all: readonly Scores[]): { area: keyof Scores; average: number }[] {
  if (all.length === 0) return [];
  const areas = ['accuracy', 'relevance', 'communication', 'completeness'] as const;
  return areas
    .map((area) => ({ area, average: Math.round((all.reduce((n, s) => n + s[area], 0) / all.length) * 10) / 10 }))
    .sort((a, b) => a.average - b.average);
}
