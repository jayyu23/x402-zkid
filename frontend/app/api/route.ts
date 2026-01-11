import { NextRequest, NextResponse } from "next/server";
import { CdpClient } from "@coinbase/cdp-sdk";
import { HTTPFacilitatorClient, x402ResourceServer, x402HTTPResourceServer } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";

// Initialize CDP client
const cdp = new CdpClient({
  apiKeyId: process.env.CDP_API_KEY_ID!,
  apiKeySecret: process.env.CDP_API_KEY_SECRET!,
  walletSecret: process.env.CDP_WALLET_SECRET!,
});

// Cache for pay-to address only (server is created per-request with dynamic price)
let payToAddress: string | null = null;

// Default price in cents (fallback)
const DEFAULT_PRICE_CENTS = 10;

// Fetch current price from backend
async function fetchCurrentPrice(walletAddress: string | null, domain: string | null): Promise<number> {
  if (!walletAddress) {
    return DEFAULT_PRICE_CENTS;
  }

  try {
    const backendUrl = process.env.BACKEND_URL || "http://localhost:3001";
    const url = new URL(`${backendUrl}/api/price/${walletAddress}`);
    if (domain) {
      url.searchParams.set("domain", domain);
    }

    const response = await fetch(url.toString(), {
      cache: "no-store",
    });

    if (response.ok) {
      const data = await response.json();
      console.log(`[x402] Fetched price for ${walletAddress}: ${data.cents} cents`);
      return data.cents || DEFAULT_PRICE_CENTS;
    }
  } catch (error) {
    console.error("[x402] Failed to fetch price from backend:", error);
  }

  return DEFAULT_PRICE_CENTS;
}

async function initializePayToAddress(): Promise<string> {
  if (payToAddress) {
    return payToAddress;
  }

  // Create or get account to receive payments
  const account = await cdp.evm.createAccount();
  payToAddress = account.address;
  console.log(`[x402] Pay-to address initialized: ${payToAddress}`);

  return payToAddress;
}

async function createHttpServer(priceInCents: number, payTo: string): Promise<x402HTTPResourceServer> {
  // Initialize facilitator client for Base Sepolia testnet
  const facilitatorClient = new HTTPFacilitatorClient({
    url: "https://x402.org/facilitator",
  });

  // Create resource server with EVM support for Base Sepolia
  const resourceServer = new x402ResourceServer(facilitatorClient);
  registerExactEvmScheme(resourceServer, {
    networks: ["eip155:84532"], // Base Sepolia
  });

  // Convert cents to dollars string
  const priceString = `$${(priceInCents / 100).toFixed(2)}`;
  console.log(`[x402] Creating server with price: ${priceString}`);

  // Define route configuration with dynamic price
  const routesConfig = {
    "GET /api": {
      accepts: [
        {
          scheme: "exact" as const,
          price: priceString,
          network: "eip155:84532" as `${string}:${string}`,
          payTo: payTo,
        },
      ],
      description: "Access to premium data (price negotiable!)",
      mimeType: "application/json",
    },
  };

  // Create HTTP resource server
  const httpServer = new x402HTTPResourceServer(resourceServer, routesConfig);
  await httpServer.initialize();

  return httpServer;
}

export async function GET(request: NextRequest) {
  try {
    // Get wallet address and domain from headers
    const walletAddress = request.headers.get("X-Wallet-Address");
    const domain = request.headers.get("X-Domain");

    console.log(`[x402] Request from wallet: ${walletAddress}, domain: ${domain}`);

    // Get pay-to address
    const payTo = await initializePayToAddress();

    // Fetch current negotiated price for this wallet
    const priceInCents = await fetchCurrentPrice(walletAddress, domain);

    // Create HTTP server with dynamic price
    const httpServer = await createHttpServer(priceInCents, payTo);

    // Create HTTP adapter for Next.js
    const adapter = {
      getHeader: (name: string) => request.headers.get(name) || undefined,
      getMethod: () => request.method,
      getPath: () => new URL(request.url).pathname,
      getUrl: () => request.url,
      getAcceptHeader: () => request.headers.get("accept") || "",
      getUserAgent: () => request.headers.get("user-agent") || "",
      getQueryParams: () => {
        const params: Record<string, string> = {};
        new URL(request.url).searchParams.forEach((value, key) => {
          params[key] = value;
        });
        return params;
      },
      getQueryParam: (name: string) => new URL(request.url).searchParams.get(name) || undefined,
      getBody: () => ({}),
    };

    // Create HTTP request context
    const context = {
      adapter,
      path: new URL(request.url).pathname,
      method: request.method,
    };

    // Process the request through x402
    const result = await httpServer.processHTTPRequest(context);

    if (result.type === "payment-error") {
      // Return 402 with payment error using the response instructions
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(result.response.headers)) {
        headers[key] = String(value);
      }

      // Add current price to the response for the client
      const existingBody = typeof result.response.body === 'object' && result.response.body !== null
        ? result.response.body
        : {};
      const body = {
        ...existingBody,
        currentPrice: {
          cents: priceInCents,
          dollars: (priceInCents / 100).toFixed(2),
        },
      };

      return new NextResponse(
        JSON.stringify(body),
        {
          status: result.response.status,
          headers,
        }
      );
    }

    if (result.type === "payment-verified") {
      // Payment signature verified - now settle the payment on-chain
      console.log("[x402] Payment verified, initiating settlement...");

      const settlementResult = await httpServer.processSettlement(
        result.paymentPayload,
        result.paymentRequirements
      );

      if (!settlementResult.success) {
        console.error("[x402] Settlement failed:", settlementResult.errorReason);
        return NextResponse.json(
          {
            error: "Payment settlement failed",
            details: settlementResult.errorReason,
          },
          { status: 402 }
        );
      }

      console.log("[x402] Settlement successful:", settlementResult);

      // Extract transaction hash from settlement response
      const txHash = settlementResult.transaction;
      const network = result.paymentRequirements.network;

      // Determine the block explorer URL based on network
      const getExplorerUrl = (network: string, txHash: string) => {
        if (network === "eip155:84532") {
          // Base Sepolia
          return `https://sepolia.basescan.org/tx/${txHash}`;
        } else if (network === "eip155:8453") {
          // Base Mainnet
          return `https://basescan.org/tx/${txHash}`;
        }
        return null;
      };

      const explorerUrl = txHash ? getExplorerUrl(network, txHash) : null;

      // Build response with settlement headers
      const responseData = {
        success: true,
        message: "Payment settled successfully! Here is your premium data.",
        data: {
          timestamp: new Date().toISOString(),
          content: "This is the secret premium data you negotiated for!",
        },
        settlement: {
          transactionHash: txHash || null,
          network: network,
          explorerUrl: explorerUrl,
          settled: true,
          pricePaid: {
            cents: priceInCents,
            dollars: (priceInCents / 100).toFixed(2),
          },
        },
      };

      // Include settlement headers from the response
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...settlementResult.headers,
      };

      return new NextResponse(JSON.stringify(responseData), {
        status: 200,
        headers,
      });
    }

    // No payment required (shouldn't happen with our config, but handle it)
    return NextResponse.json({
      success: true,
      message: "Request processed",
    });
  } catch (error) {
    console.error("Payment processing error:", error);
    return NextResponse.json(
      {
        error: "Payment processing failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
