import crypto from "crypto";

export type Tier = "low" | "high" | "blocked";

export type Resource = { id: string; name: string; description: string };

export type Quote = { resource_id: string; tier: Tier; base_price_usdc: string; final_price_usdc: string; discount_reason: string; expires_at: number; nonce: string; policy: { min_price_usdc: string; max_discount_pct: number } };

const RESOURCES: Record<string, Resource> = {
  "research-docs": {
    id: "research-docs",
    name: "Research Docs",
    description: "Premium documents and endpoints",
  },
  "trading-signals": {
    id: "trading-signals",
    name: "Trading Signals",
    description: "Premium signals endpoint",
  },
};

export function getResource(resource_id: string): Resource | null {
  return RESOURCES[resource_id] || null;
}

export function computeQuote(args: {
  resource_id: string;
  tier: Tier;
}): Quote {
  const resource = getResource(args.resource_id);
  if (!resource) {
    throw new Error("RESOURCE_NOT_FOUND");
  }

  if (args.tier === "blocked") {
    throw new Error("DOMAIN_BLOCKED");
  }

  // Domain-based ability-to-pay pricing rules
  // Base price is $50 USDC for all non-blocked users
  const base_price_usdc = "50.00";
  
  let final_price_usdc: string;
  let discount_reason: string;

  if (args.tier === "low") {
    // Low tier: .edu or .org domains pay $1 USDC
    final_price_usdc = "1.00";
    discount_reason = "edu_org_pricing";
  } else {
    // High tier: commercial domains pay $50 USDC
    final_price_usdc = "50.00";
    discount_reason = "commercial_pricing";
  }

  // Generate nonce
  const nonce = crypto.randomBytes(16).toString("hex");

  // Set expiration to 10 minutes from now
  const expires_at = Math.floor(Date.now() / 1000) + 10 * 60;

  // Policy: allows 98% discount (from $50 to $1)
  const policy = {
    min_price_usdc: "1.00",
    max_discount_pct: 98,
  };

  return {
    resource_id: args.resource_id,
    tier: args.tier,
    base_price_usdc,
    final_price_usdc,
    discount_reason,
    expires_at,
    nonce,
    policy,
  };
}

