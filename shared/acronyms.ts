// Acronyms with several common meanings in interviews. The answer must say which meaning it
// assumes, or ask (FR-U11). Meanings are listed most-likely-first for SRE and networking.
export const AMBIGUOUS_ACRONYMS: Record<string, string[]> = {
  AAA: ['authentication, authorization and accounting', 'triple-A credit rating', 'Arrange-Act-Assert (testing)'],
  AA: ['active-active (high availability)', 'Azure AD shorthand', 'something else in your context'],
  PCI: ['PCI DSS (payment card security standard)', 'PCI bus (hardware)'],
  CSP: ['cloud service provider', 'Content Security Policy'],
  ARP: ['Address Resolution Protocol', 'average revenue per user (ARPU) misheard'],
  SSO: ['single sign-on', 'site-specific shorthand'],
  CA: ['certificate authority', 'Cluster Autoscaler', 'California'],
  HA: ['high availability', 'HAProxy shorthand'],
  PR: ['pull request', 'public relations'],
  SRE: ['site reliability engineering / engineer'],
};

/** Ambiguous acronyms that appear (as whole words) in the text. */
export function findAmbiguousAcronyms(text: string): { acronym: string; meanings: string[] }[] {
  return Object.entries(AMBIGUOUS_ACRONYMS)
    .filter(([acronym, meanings]) => meanings.length > 1 && new RegExp(`(?<![\\w-])${acronym}(?![\\w-])`, 'i').test(text))
    .map(([acronym, meanings]) => ({ acronym, meanings }));
}
