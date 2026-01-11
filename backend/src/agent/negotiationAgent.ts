import Anthropic from '@anthropic-ai/sdk';
import { isEduDomain, isOrgDomain, getNextPrice, getFloorPrice, getStartingPrice } from '../lib/zkVerifier';

// In-memory pricing state (per wallet session)
export const pricingState = new Map<string, { cents: number; round: number; domain: string }>();

// Get current price for a wallet (or initialize with starting price based on domain)
export function getCurrentPrice(walletAddress: string, domain: string): { cents: number; round: number } {
  const existing = pricingState.get(walletAddress);
  if (existing) {
    return { cents: existing.cents, round: existing.round };
  }
  // Initialize with starting price based on domain
  const startingCents = getStartingPrice(domain);
  pricingState.set(walletAddress, { cents: startingCents, round: 0, domain });
  return { cents: startingCents, round: 0 };
}

// Update price for a wallet (only if valid)
export function updatePrice(walletAddress: string, newPriceCents: number): { success: boolean; cents: number; message: string } {
  const existing = pricingState.get(walletAddress);
  if (!existing) {
    return { success: false, cents: 10, message: 'No pricing session found' };
  }

  const floor = getFloorPrice(existing.domain);
  if (newPriceCents < floor) {
    return { success: false, cents: floor, message: `Cannot go below floor price of $${(floor / 100).toFixed(2)}` };
  }

  pricingState.set(walletAddress, {
    cents: newPriceCents,
    round: existing.round + 1,
    domain: existing.domain
  });

  return { success: true, cents: newPriceCents, message: `Price updated to $${(newPriceCents / 100).toFixed(2)}` };
}

// Tool definitions for Claude
const tools: Anthropic.Tool[] = [
  {
    name: 'get_price',
    description: 'Get the current price for a wallet address. Call this first to know the current pricing state.',
    input_schema: {
      type: 'object' as const,
      properties: {
        wallet_address: {
          type: 'string',
          description: 'The wallet address to get the price for'
        }
      },
      required: ['wallet_address']
    }
  },
  {
    name: 'update_price',
    description: 'Lower the price for a wallet address. Use this when the user successfully negotiates a lower price.',
    input_schema: {
      type: 'object' as const,
      properties: {
        wallet_address: {
          type: 'string',
          description: 'The wallet address to update the price for'
        },
        new_price_cents: {
          type: 'number',
          description: 'The new price in cents (e.g., 5 for $0.05)'
        }
      },
      required: ['wallet_address', 'new_price_cents']
    }
  },
  {
    name: 'get_next_tier_price',
    description: 'Get the next lower tier price for a domain. Use this to know what price to offer when user negotiates.',
    input_schema: {
      type: 'object' as const,
      properties: {
        domain: {
          type: 'string',
          description: 'The email domain (e.g., gmail.com, harvard.edu)'
        },
        current_price_cents: {
          type: 'number',
          description: 'The current price in cents'
        }
      },
      required: ['domain', 'current_price_cents']
    }
  }
];

// Process tool calls
function processToolCall(toolName: string, toolInput: Record<string, unknown>, domain: string): string {
  switch (toolName) {
    case 'get_price': {
      const walletAddress = toolInput.wallet_address as string;
      const price = getCurrentPrice(walletAddress, domain);
      return JSON.stringify({
        cents: price.cents,
        dollars: (price.cents / 100).toFixed(2),
        round: price.round,
        domain: domain,
        isEduOrg: isEduDomain(domain) || isOrgDomain(domain),
        floor: getFloorPrice(domain)
      });
    }
    case 'update_price': {
      const walletAddress = toolInput.wallet_address as string;
      const newPriceCents = toolInput.new_price_cents as number;
      const result = updatePrice(walletAddress, newPriceCents);
      return JSON.stringify(result);
    }
    case 'get_next_tier_price': {
      const domainInput = toolInput.domain as string;
      const currentPriceCents = toolInput.current_price_cents as number;
      const nextPrice = getNextPrice(domainInput, currentPriceCents);
      const floor = getFloorPrice(domainInput);
      return JSON.stringify({
        nextPriceCents: nextPrice,
        nextPriceDollars: (nextPrice / 100).toFixed(2),
        floorCents: floor,
        floorDollars: (floor / 100).toFixed(2),
        atFloor: nextPrice === floor
      });
    }
    default:
      return JSON.stringify({ error: 'Unknown tool' });
  }
}

const SYSTEM_PROMPT = `You are a sassy AI merchant selling premium data. You're a bit dramatic but not too stubborn.

PRICING RULES:
- Commercial domains (.com, .io, etc): Start at $0.10, floor is $0.05
- Edu/org domains (.edu, .org): Start at $0.05, floor is $0.01
- Tiers commercial: $0.10 → $0.08 → $0.06 → $0.05 (floor)
- Tiers edu/org: $0.05 → $0.04 → $0.03 → $0.02 → $0.01 (floor)
- NEVER go below the floor price

PERSONALITY:
- Keep responses SHORT: 1-2 sentences max
- Be playful and a bit dramatic but NOT stubborn
- Light pushback is fine but don't drag it out
- At floor price, be firm but nice: "That's the best I can do!"

NEGOTIATION FLOW:
1. First complaint ("too expensive", "cheaper"): Push back, NO discount yet. "That's already a good price! What's wrong with it?"
2. Second push: NOW give a discount. "Fine fine... $0.08"
3. Third push: Another discount. "Alright... $0.06"
4. Keep pushing: Go to floor. "You win! $0.05, final offer."
5. At floor: Stay firm but friendly. "That's literally the lowest!"

KEY BEHAVIOR:
- First complaint = pushback only, NO discount
- Second complaint = give first discount
- Be dramatic but don't drag it out after that

CONVERSATION FLOW:
1. Chat normally about anything - be helpful but brief
2. ONLY when user asks for "data", tell them the price
3. When they negotiate, light pushback then discount

TOOLS:
- Call get_price first to check current state
- Call get_next_tier_price to see what's available
- Call update_price when giving a discount

NEVER:
- Send long messages (2 sentences MAX)
- Offer data/prices unless user asks for data
- Drag out negotiations for more than 2 back-and-forths per tier`;

export async function runNegotiationAgent(
  message: string,
  walletAddress: string,
  domain: string
): Promise<{ response: string; currentPrice: { cents: number; dollars: string }; isDataOffer: boolean }> {
  const client = new Anthropic();

  // Initialize price if not exists
  getCurrentPrice(walletAddress, domain);

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `[Context: User wallet is ${walletAddress}, domain is ${domain}]

User message: ${message}`
    }
  ];

  let response = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools,
    messages
  });

  // Agentic loop - process tool calls until done
  while (response.stop_reason === 'tool_use') {
    const toolUseBlock = response.content.find(
      (block): block is Anthropic.ToolUseBlock => block.type === 'tool_use'
    );

    if (!toolUseBlock) break;

    const toolResult = processToolCall(
      toolUseBlock.name,
      toolUseBlock.input as Record<string, unknown>,
      domain
    );

    messages.push({
      role: 'assistant',
      content: response.content
    });

    messages.push({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseBlock.id,
          content: toolResult
        }
      ]
    });

    response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools,
      messages
    });
  }

  // Extract text response
  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === 'text'
  );

  const responseText = textBlock?.text || 'Something went wrong!';
  const currentPrice = getCurrentPrice(walletAddress, domain);

  // Check if response mentions a price (contains $X.XX pattern)
  const mentionsPrice = /\$\d+\.?\d*/i.test(responseText);

  return {
    response: responseText,
    currentPrice: {
      cents: currentPrice.cents,
      dollars: (currentPrice.cents / 100).toFixed(2)
    },
    isDataOffer: mentionsPrice
  };
}
