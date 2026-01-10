// TODO: This extraction-only logic is temporary until real ZK proof verification + domain claim derivation is implemented.

export type ZkIdProofLike = any;

export type Tier = "low" | "high" | "blocked";

/**
 * Normalizes a raw input (domain or email) to a valid domain string.
 * Accepts either a domain ("stanford.edu") or a full email ("user@stanford.edu").
 * Returns null if the input cannot be normalized to a valid domain.
 */
export function normalizeToDomain(raw: unknown): string | null {
  // Must be a string
  if (typeof raw !== "string") {
    return null;
  }

  // Trim and lowercase
  let normalized = raw.trim().toLowerCase();

  // Extract domain from email if "@" is present
  if (normalized.includes("@")) {
    const lastAt = normalized.lastIndexOf("@");
    normalized = normalized.substring(lastAt + 1);
  }

  // Remove leading brackets/parentheses: <, (, [
  while (normalized.startsWith("<") || normalized.startsWith("(") || normalized.startsWith("[")) {
    normalized = normalized.substring(1);
  }

  // Remove trailing brackets/parentheses/period: >, ), ], .
  while (normalized.endsWith(">") || normalized.endsWith(")") || normalized.endsWith("]") || normalized.endsWith(".")) {
    normalized = normalized.slice(0, -1);
  }

  // Reject strings with spaces
  if (normalized.includes(" ")) {
    return null;
  }

  // Reject strings without a dot (must have at least TLD)
  if (!normalized.includes(".")) {
    return null;
  }

  return normalized;
}

/**
 * Extracts and normalizes a domain from a ZK proof object by checking
 * multiple likely fields in order. Returns the first valid domain found, or null.
 */
export function extractDomainFromZkIdProof(proof: ZkIdProofLike): string | null {
  // Check proof.domain
  const domain1 = normalizeToDomain(proof?.domain);
  if (domain1) return domain1;

  // Check proof.emailDomain
  const domain2 = normalizeToDomain(proof?.emailDomain);
  if (domain2) return domain2;

  // Check proof.claims?.domain
  const domain3 = normalizeToDomain(proof?.claims?.domain);
  if (domain3) return domain3;

  // Check proof.claims?.emailDomain
  const domain4 = normalizeToDomain(proof?.claims?.emailDomain);
  if (domain4) return domain4;

  // Check proof.publicSignals?.[0]
  const domain5 = normalizeToDomain(proof?.publicSignals?.[0]);
  if (domain5) return domain5;

  // Check proof.public_signals?.[0]
  const domain6 = normalizeToDomain(proof?.public_signals?.[0]);
  if (domain6) return domain6;

  return null;
}

/**
 * Extracts the pricing tier from a ZK proof based on domain classification.
 * - No domain found => "blocked" (fail-closed approach)
 * - Domain ends with .edu or .org => "low" ($1 USDC)
 * - All other domains => "high" ($50 USDC)
 */
export function extractTierFromZkIdProof(proof: ZkIdProofLike): Tier {
  const domain = extractDomainFromZkIdProof(proof);

  // If no domain found, return "blocked" (fail-closed approach)
  // This prevents mis-pricing legitimate users due to:
  // - client bugs / mismatched proof format
  // - attacker stripping fields
  // - new proof schema not handled by parser
  // The pricing layer will throw DOMAIN_BLOCKED when tier is "blocked"
  if (!domain) {
    return "blocked";
  }

  // Low tier: .edu or .org domains (educational and non-profit organizations)
  if (domain.endsWith(".edu") || domain.endsWith(".org")) {
    return "low";
  }

  // High tier: commercial domains (.com, .io, .ai, etc.) and VC/startup emails
  // This includes all other domains that don't match edu/org
  return "high";
}

