export function isEduDomain(domain: string): boolean {
  return domain.endsWith('.edu')
}

export function isOrgDomain(domain: string): boolean {
  return domain.endsWith('.org')
}

export function canNegotiate(domain: string): boolean {
  return isEduDomain(domain) || isOrgDomain(domain)
}

export function getPrice(domain: string): { cents: number; display: string } {
  // Base price is 2 cents for everyone
  // edu/org can negotiate down to 1 cent
  return { cents: 2, display: '2 cents USDC' }
}
