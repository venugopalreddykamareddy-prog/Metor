import { TECH_TERMS, correctTerms } from '../../../shared/vocabulary.ts';

/** Lowercase words with punctuation removed; keeps "/" and "-" inside terms like CI/CD and on-call. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s/-]+/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && w !== '-');
}

/** Word error rate: (substitutions + deletions + insertions) / reference words, via edit distance. */
export function wordErrorRate(reference: string, hypothesis: string): number {
  const ref = words(reference);
  const hyp = words(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  let prev = Array.from({ length: hyp.length + 1 }, (_, j) => j);
  for (let i = 1; i <= ref.length; i++) {
    const row = [i];
    for (let j = 1; j <= hyp.length; j++) {
      const cost = ref[i - 1] === hyp[j - 1] ? 0 : 1;
      row[j] = Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    prev = row;
  }
  return (prev[hyp.length] ?? 0) / ref.length;
}

/** Which technical terms in the reference also appear in the hypothesis (case-insensitive). */
export function termRecall(reference: string, hypothesis: string): { found: string[]; missed: string[] } {
  const ref = ` ${words(correctTerms(reference)).join(' ')} `;
  const hyp = ` ${words(hypothesis).join(' ')} `;
  const found: string[] = [];
  const missed: string[] = [];
  for (const term of TECH_TERMS) {
    const needle = ` ${words(term).join(' ')} `;
    if (!ref.includes(needle)) continue;
    (hyp.includes(needle) ? found : missed).push(term);
  }
  return { found, missed };
}

/** Script for the accuracy check: everyday interview phrasing with dense technical terms. */
export const ACCURACY_SCRIPT = `How would you define an SLO and an error budget for a payments API?
I would start with p99 latency and availability, then alert on burn rate in Datadog and Grafana.
After a bad deploy I run kubectl rollout undo and check the kubelet logs on the AKS nodes.
We manage EKS clusters with Terraform and deploy with Argo CD and Helm charts from GitHub Actions.
Our Prometheus alerts page the on-call engineer through PagerDuty, and we write a postmortem.
Traffic enters through Azure Front Door, secrets live in Key Vault, and data sits in Cosmos DB.
In AWS each VPC has private subnets, IAM roles, and Route 53 health checks.
BGP chooses the best path using local preference and AS path length, while OSPF uses cost.
We moved branches to SD-WAN and inspect traffic on Palo Alto firewalls managed by Panorama.
If DNS resolution fails, I capture packets in Wireshark and check the TLS handshake.`;
