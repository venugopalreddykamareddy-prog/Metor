// Technical vocabulary used three ways: as a spelling prompt for Groq Whisper, as boosted phrases
// for Web Speech (where supported), and to fix common mishearings in final transcript text.

interface Term {
  /** How the term should be written. */
  canonical: string;
  /** Other ways recognizers write it, matched case-insensitively as whole words. */
  heard?: string[];
}

const TERMS: Term[] = [
  // SRE / operations
  { canonical: 'SLO', heard: ['s l o', 's.l.o.'] },
  { canonical: 'SLOs', heard: ['s l o s', 'slows'] },
  { canonical: 'SLI', heard: ['s l i'] },
  { canonical: 'SLA', heard: ['s l a'] },
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
  { canonical: 'Kubernetes', heard: ['cooper netties', 'kuber netties', 'kubernetis', 'cuber netes'] },
  { canonical: 'kubectl', heard: ['cube cuddle', 'cube control', 'kube control', 'cube ctl', 'kube ctl', 'cubectl'] },
  { canonical: 'k8s', heard: ['k eights', 'k 8 s'] },
  { canonical: 'kubelet', heard: ['cubelet', 'cube let'] },
  { canonical: 'etcd', heard: ['et cd', 'etc d'] },
  { canonical: 'Helm' },
  { canonical: 'Argo CD', heard: ['argo cd', 'argocd', 'argo c d'] },
  { canonical: 'Istio', heard: ['east io', 'is tio'] },
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
  { canonical: 'Panorama' },
  { canonical: 'Zscaler', heard: ['z scaler', 'zee scaler'] },
  { canonical: 'Fortinet', heard: ['fortinet', 'forty net'] },
  { canonical: 'F5 BIG-IP', heard: ['f5 big ip', 'f 5 big ip'] },
  { canonical: 'Cisco ASA', heard: ['cisco a s a'] },
  { canonical: 'Wireshark', heard: ['wire shark'] },
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
  [term.canonical, ...(term.heard ?? [])].map((phrase): [string, string] => [phrase, term.canonical]),
)
  .sort((a, b) => b[0].length - a[0].length)
  .map(([phrase, canonical]) => [new RegExp(`(?<![\\w/'’])${phrasePattern(phrase)}\\.?(?![\\w/])`, 'gi'), canonical]);

/** Fixes known mishearings and the casing of technical terms in final transcript text. */
export function correctTerms(text: string): string {
  let result = text;
  for (const [pattern, canonical] of CORRECTIONS) result = result.replace(pattern, canonical);
  return result;
}

/** All canonical terms, e.g. for the accuracy check's term recall. */
export const TECH_TERMS: readonly string[] = TERMS.map((t) => t.canonical);

/** Short spelling hint for Whisper (Groq limits prompts to 224 tokens; this is well under). */
export const WHISPER_PROMPT = `Technical interview about SRE, cloud and networking: ${TERMS.slice(0, 70)
  .map((t) => t.canonical)
  .join(', ')}.`;
