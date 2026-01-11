export function isEduDomain(domain: string): boolean {
  return domain.endsWith('.edu')
}

export function isOrgDomain(domain: string): boolean {
  return domain.endsWith('.org')
}

export function canNegotiate(domain: string): boolean {
  // Everyone can negotiate now!
  return true
}

// Pricing tiers in cents
export const PRICING = {
  commercial: {
    start: 10,      // $0.10
    floor: 5,       // $0.05
    tiers: [10, 8, 6, 5]  // $0.10 → $0.08 → $0.06 → $0.05
  },
  eduOrg: {
    start: 5,       // $0.05
    floor: 1,       // $0.01
    tiers: [5, 4, 3, 2, 1]  // $0.05 → $0.04 → $0.03 → $0.02 → $0.01
  }
}

// Get pricing config for a domain
function getPricingConfig(domain: string) {
  return (isEduDomain(domain) || isOrgDomain(domain)) ? PRICING.eduOrg : PRICING.commercial
}

// Get starting price for a domain (in cents)
export function getStartingPrice(domain: string): number {
  return getPricingConfig(domain).start
}

// Get floor price for a domain (in cents)
export function getFloorPrice(domain: string): number {
  return getPricingConfig(domain).floor
}

// Get next tier price (in cents) - returns current if already at floor
export function getNextPrice(domain: string, currentCents: number): number {
  const config = getPricingConfig(domain)
  const currentIndex = config.tiers.indexOf(currentCents)

  if (currentIndex === -1) {
    // Price not in tiers, find closest lower tier
    for (let i = 0; i < config.tiers.length; i++) {
      if (config.tiers[i] < currentCents) {
        return config.tiers[i]
      }
    }
    return config.floor
  }

  if (currentIndex >= config.tiers.length - 1) {
    // Already at floor
    return config.floor
  }

  return config.tiers[currentIndex + 1]
}

// Legacy function for backwards compatibility
export function getPrice(domain: string): { cents: number; display: string } {
  const cents = getStartingPrice(domain)
  return {
    cents,
    display: `$${(cents / 100).toFixed(2)} USDC`
  }
}
