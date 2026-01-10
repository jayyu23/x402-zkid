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

// Cache for server initialization
let payToAddress: string | null = null;
let httpServer: x402HTTPResourceServer | null = null;

async function initializeServer() {
  if (httpServer && payToAddress) {
    return { httpServer, payToAddress };
  }

  // Create or get account to receive payments
  const account = await cdp.evm.createAccount();
  payToAddress = account.address;

  // Initialize facilitator client for Base Sepolia testnet
  const facilitatorClient = new HTTPFacilitatorClient({
    url: "https://x402.org/facilitator",
  });

  // Create resource server with EVM support for Base Sepolia
  const resourceServer = new x402ResourceServer(facilitatorClient);
  registerExactEvmScheme(resourceServer, {
    networks: ["eip155:84532"], // Base Sepolia
  });

  // Define route configuration
  const routesConfig = {
    "GET /api": {
      accepts: [
        {
          scheme: "exact" as const,
          price: "$0.01",
          network: "eip155:84532" as `${string}:${string}`,
          payTo: payToAddress,
        },
      ],
      description: "Access to API endpoint",
      mimeType: "application/json",
    },
  };

  // Create HTTP resource server
  httpServer = new x402HTTPResourceServer(resourceServer, routesConfig);
  await httpServer.initialize();

  return { httpServer, payToAddress };
}

export async function GET(request: NextRequest) {
  try {
    const { httpServer } = await initializeServer();

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

      return new NextResponse(
        JSON.stringify(result.response.body),
        {
          status: result.response.status,
          headers,
        }
      );
    }

    if (result.type === "payment-verified") {
      // Payment was successful - return the actual API response
      return NextResponse.json({
        success: true,
        message: "Payment accepted and verified",
        data: {
          // Your actual API response data here
          timestamp: new Date().toISOString(),
        },
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
