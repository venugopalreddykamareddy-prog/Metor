// Technical vocabulary used three ways: as a spelling prompt for Groq Whisper, as boosted phrases
// for Web Speech (where supported), and to fix known mishearings in the cleaned transcript.
// Only exact, listed variants are replaced; unfamiliar words are never guessed into known terms.

interface Term {
  /** How the term should be written. */
  canonical: string;
  /** Known ways recognizers write it, matched case-insensitively as whole words. */
  heard?: string[];
  /** Also an ordinary English word (helm, panorama): don't force its capitalization. */
  common?: boolean;
}

const TERMS: Term[] = [
  // SRE / operations
  { canonical: 'SLO', heard: ['s l o', 's.l.o.'] },
  { canonical: 'SLOs', heard: ['s l o s'] },
  { canonical: 'SLI', heard: ['s l i', 's.l.i.'] },
  { canonical: 'SLIs', heard: ['s l i s'] },
  { canonical: 'SLA', heard: ['s l a', 's.l.a.'] },
  { canonical: 'SLAs', heard: ['s l a s'] },
  { canonical: 'MTTR', heard: ['m t t r'] },
  { canonical: 'p99', heard: ['p 99', 'p ninety nine', 'pee 99'] },
  { canonical: 'p95', heard: ['p 95', 'p ninety five'] },
  { canonical: 'error budget' },
  { canonical: 'on-call', heard: ['on call'] },
  { canonical: 'postmortem', heard: ['post mortem', 'post-mortem'] },
  { canonical: 'runbook', heard: ['run book'] },
  { canonical: 'PagerDuty', heard: ['pager duty'] },
  { canonical: 'Datadog', heard: ['data dog'] },
  { canonical: 'Prometheus' },
  { canonical: 'Grafana', heard: ['grafanna', 'gravana'] },
  { canonical: 'OpenTelemetry', heard: ['open telemetry'] },
  { canonical: 'Splunk' },
  // Containers / Kubernetes / delivery
  { canonical: 'Kubernetes', heard: ['cooper netties', 'kuber netties', 'kubernetis', 'kubernetties', 'cuber netes'] },
  { canonical: 'kubectl', heard: ['cube cuddle', 'cube control', 'kube control', 'cube ctl', 'kube ctl', 'cubectl', 'kube cuddle'] },
  { canonical: 'k8s', heard: ['k eights', 'k 8 s'] },
  { canonical: 'kubelet', heard: ['cubelet', 'cube let'] },
  { canonical: 'etcd', heard: ['et cd'] },
  { canonical: 'Helm', common: true },
  { canonical: 'Argo CD', heard: ['argo cd', 'argocd', 'argo c d'] },
  { canonical: 'Istio' },
  { canonical: 'Docker' },
  { canonical: 'Terraform', heard: ['terra form'] },
  { canonical: 'Ansible' },
  { canonical: 'GitHub Actions', heard: ['git hub actions'] },
  { canonical: 'Jenkins' },
  { canonical: 'CI/CD', heard: ['ci cd', 'c i c d'] },
  { canonical: 'AKS', heard: ['a k s'] },
  { canonical: 'EKS', heard: ['e k s'] },
  { canonical: 'GKE', heard: ['g k e'] },
  // Cloud
  { canonical: 'AWS', heard: ['a w s'] },
  { canonical: 'EC2', heard: ['e c 2', 'ec two'] },
  { canonical: 'S3', heard: ['s 3', 's three'] },
  { canonical: 'IAM', heard: ['i a m'] },
  { canonical: 'VPC', heard: ['v p c'] },
  { canonical: 'Route 53', heard: ['route fifty three', 'root 53'] },
  { canonical: 'CloudWatch', heard: ['cloud watch'] },
  { canonical: 'Azure' },
  { canonical: 'Azure Front Door', heard: ['azure front door'] },
  { canonical: 'Key Vault', heard: ['key vault', 'keyvault'] },
  { canonical: 'Cosmos DB', heard: ['cosmos db', 'cosmos d b', 'cosmosdb'] },
  { canonical: 'Azure Functions' },
  // Networking / security
  { canonical: 'BGP', heard: ['b g p'] },
  { canonical: 'OSPF', heard: ['o s p f'] },
  { canonical: 'EIGRP', heard: ['e i g r p'] },
  { canonical: 'MPLS', heard: ['m p l s'] },
  { canonical: 'SD-WAN', heard: ['sd wan', 's d wan', 'sdwan'] },
  { canonical: 'DNS', heard: ['d n s'] },
  { canonical: 'TCP/IP', heard: ['tcp ip'] },
  { canonical: 'TLS', heard: ['t l s'] },
  { canonical: 'Palo Alto', heard: ['palo alto'] },
  { canonical: 'Panorama', common: true },
  { canonical: 'Zscaler', heard: ['z scaler', 'zee scaler'] },
  { canonical: 'Fortinet' },
  { canonical: 'F5 BIG-IP', heard: ['f5 big ip', 'f 5 big ip'] },
  { canonical: 'Cisco ASA', heard: ['cisco a s a'] },
  { canonical: 'Wireshark', heard: ['wire shark'] },
  // General infrastructure. Skips acronyms that clash with normal words or commands (cd, ha, dr).
  { canonical: 'API' },
  { canonical: 'APIs' },
  { canonical: 'URL' },
  { canonical: 'HTTP' },
  { canonical: 'HTTPS' },
  { canonical: 'REST', common: true },
  { canonical: 'gRPC', heard: ['g rpc', 'grpc'] },
  { canonical: 'JSON' },
  { canonical: 'YAML' },
  { canonical: 'CPU' },
  { canonical: 'RAM', common: true },
  { canonical: 'SQL' },
  { canonical: 'VM' },
  { canonical: 'VMs' },
  { canonical: 'VPN' },
  { canonical: 'CDN' },
  { canonical: 'DDoS', heard: ['ddos', 'd dos'] },
  { canonical: 'RCA', heard: ['r c a'] },
  { canonical: 'RTO' },
  { canonical: 'RPO' },
  { canonical: 'SSH' },
  { canonical: 'Linux' },
  { canonical: 'PostgreSQL', heard: ['postgres sql', 'postgre sql'] },
  { canonical: 'MySQL', heard: ['my sql'] },
  { canonical: 'Redis' },
  { canonical: 'Kafka' },
  { canonical: 'NGINX', heard: ['engine x'] },
];

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** "a k s" matches "a k s", "a-k-s", "a.k.s." etc.; spaces in a phrase match any run of spaces, dots, or hyphens. */
function phrasePattern(phrase: string): string {
  return phrase
    .split(/[\s.-]+/)
    .filter(Boolean)
    .map(escapeRegex)
    .join('[\\s.-]+');
}

// Longest phrases first, so "Azure Front Door" wins over "Azure".
const CORRECTIONS: [RegExp, string][] = TERMS.flatMap((term) =>
  [...(term.common ? [] : [term.canonical]), ...(term.heard ?? [])].map((phrase): [string, string] => [
    phrase,
    term.canonical,
  ]),
)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([phrase, canonical]) => [new RegExp(`(?<![\\w/'’])${phrasePattern(phrase)}\\.?(?![\\w/])`, 'gi'), canonical]);

// Mishearings that are also normal English, fixed only next to words that make the meaning clear.
// "as your manager" stays; "as your front door" becomes "Azure Front Door".
const AZURE_PRODUCTS =
  'front door|key vault|functions?|devops|kubernetes service|monitor|active directory|ad|portal|subscriptions?|cosmos db|app service|blob storage|storage accounts?|virtual machines?|vms?|load balancers?|firewall|sql|event hubs?|service bus|aks|cloud';
const CONTEXT_CORRECTIONS: [RegExp, (match: string, ...groups: string[]) => string][] = [
  [new RegExp(`\\b(?:as your|as you're|azur)\\s+(${AZURE_PRODUCTS})\\b`, 'gi'), (_m, product) => `Azure ${product}`],
  // "cube" alone is a normal word; "cube get pods" / "cube apply" is kubectl.
  [/\b(?:cube|kube)\s+(get|apply|describe|delete|logs|exec|rollout|scale|port-forward|config)\b/gi, (_m, verb) => `kubectl ${verb}`],
];

// "SLO" said aloud ("ess-el-oh") is often written as "solo". "Solo" is also normal English
// ("I worked solo", "a guitar solo", "a solo project"), so it's changed only with clear evidence,
// all of it from explicit word lists:
//  1. "an solo": "an" fits "ess-el-oh", not "solo".
//  2. A reliability word right next to it: "latency solo", "solo target", "solo burn rate",
//     "solo of 99.9", "SLI and solo".
//  3. A determiner before it ("the solo", "our solos", "define a solo") and a reliability word
//     elsewhere in the sentence, unless the next word makes it the ordinary adjective
//     ("a solo project", "a guitar solo" has no determiner directly before "solo").
const SLO_BEFORE =
  'sli|slis|sla|slas|slo|slos|availability|latency|uptime|reliability|error[- ]rate|durability|freshness|throughput|p99|p95|p50|service[- ]level';
const SLO_AFTER =
  'targets?|burn(?:[- ]rate)?|burn[- ]rates|breach(?:es)?|violations?|compliance|attainment|windows?|thresholds?|alerts?|alerting|dashboards?|definitions?|policy|policies|(?:and an?|and|vs\\.?|versus|or) (?:slis?|slas?)|of \\d+';
const SLO_CONTEXT =
  /\b(?:slis?|slas?|slos?|error budgets?|burn rates?|availability|latency|uptime|reliability|nines|service[- ]level|p99|p95|p50|sre|on-?call|alerting|\d+(?:\.\d+)?\s*(?:%|percent))\b/i;
// "a solo project": solo is an adjective here, never the acronym.
const SOLO_NOUNS =
  'project|projects|career|album|artist|act|trip|travel|traveler|traveller|flight|founder|developer|dev|engineer|effort|work|performance|show|mission|climb|run|adventure|venture|practice|piece|player|ride|session|attempt|job|parent|entrepreneur|game|mode|queue|play|sailor|hike|record|debut|exhibition|instrument|guitar|violin|piano|drum|drums|on-call|oncall|sre|sres|operator|maintainer|owner|contributor|consultant';
const DETERMINER = "a|an|the|our|your|their|my|his|her|its|each|every|per|this|that|these|those|which|what|one|many|few|several|multiple|separate|different|define|defining";

function fixSolo(text: string): string {
  const plural = (s: string) => (/s$/i.test(s) ? 'SLOs' : 'SLO');
  let result = text.replace(/\b(an)\s+(solos?)\b/gi, (_m, an: string, solo: string) => `${an} ${plural(solo)}`);
  result = result.replace(new RegExp(`\\b(${SLO_BEFORE})\\s+(solos?)\\b`, 'gi'), (_m, before: string, solo: string) => `${before} ${plural(solo)}`);
  result = result.replace(new RegExp(`\\b(solos?)(?=\\s+(?:${SLO_AFTER})\\b)`, 'gi'), (solo: string) => plural(solo));
  if (SLO_CONTEXT.test(result.replace(/\bsolos?\b/gi, ''))) {
    result = result.replace(
      new RegExp(`\\b((?:${DETERMINER})\\s+)(solos?)\\b(?!\\s+(?:${SOLO_NOUNS})\\b)`, 'gi'),
      (_m, before: string, solo: string) => `${before}${plural(solo)}`,
    );
  }
  return result;
}

/** Fixes known mishearings and the casing of technical terms. Unknown words are left alone. */
export function correctTerms(text: string): string {
  let result = fixSolo(text);
  for (const [pattern, fix] of CONTEXT_CORRECTIONS) result = result.replace(pattern, fix);
  for (const [pattern, canonical] of CORRECTIONS) result = result.replace(pattern, canonical);
  return result;
}

/** Replaces a user-supplied phrase (whole words, any case, flexible spacing) with its correction. */
export function replacePhrase(text: string, heard: string, correct: string): string {
  const pattern = phrasePattern(heard.trim());
  if (!pattern) return text;
  return text.replace(new RegExp(`(?<![\\w/'’])${pattern}(?![\\w/])`, 'gi'), correct);
}

/** All canonical terms, e.g. for the accuracy check's term recall. */
export const TECH_TERMS: readonly string[] = TERMS.map((t) => t.canonical);

// Hand-picked spelling hints for Whisper, a few per domain. Groq allows 224 tokens, so keep it short.
const WHISPER_TERMS = [
  'SLI', 'SLO', 'SLA', 'error budget', 'p99', 'MTTR', 'postmortem', 'PagerDuty', 'Datadog', 'Prometheus', 'Grafana',
  'Kubernetes', 'kubectl', 'kubelet', 'etcd', 'Helm', 'Argo CD', 'Terraform', 'Ansible', 'CI/CD',
  'AWS', 'EKS', 'EC2', 'IAM', 'VPC', 'Route 53', 'Azure', 'AKS', 'Azure Front Door', 'Key Vault', 'Cosmos DB',
  'BGP', 'OSPF', 'EIGRP', 'MPLS', 'SD-WAN', 'DNS', 'TLS', 'Palo Alto', 'Zscaler', 'F5 BIG-IP', 'Wireshark',
];
export const WHISPER_PROMPT = `Technical interview about SRE, cloud and networking: ${WHISPER_TERMS.join(', ')}.`;
