import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import type { ConnectedWallet } from "@privy-io/react-auth";

/**
 * ClientEvmSigner type expected by x402
 */
interface ClientEvmSigner {
  readonly address: `0x${string}`;
  signTypedData(message: {
    domain: Record<string, unknown>;
    types: Record<string, unknown>;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<`0x${string}`>;
}

/**
 * Serialize object to JSON, converting BigInt to string
 */
function serializeWithBigInt(obj: unknown): string {
  return JSON.stringify(obj, (_, value) =>
    typeof value === "bigint" ? value.toString() : value
  );
}

/**
 * Create a ClientEvmSigner from a Privy embedded wallet
 * This allows us to use Privy's wallet with the x402 SDK
 */
export async function createSignerFromPrivyWallet(
  wallet: ConnectedWallet
): Promise<ClientEvmSigner> {
  const provider = await wallet.getEthereumProvider();
  const address = wallet.address as `0x${string}`;

  return {
    address,
    async signTypedData(typedData) {
      const signature = await provider.request({
        method: "eth_signTypedData_v4",
        params: [address, serializeWithBigInt(typedData)],
      });
      return signature as `0x${string}`;
    },
  };
}

/**
 * Create an x402-enabled fetch function using a Privy wallet
 */
export async function createX402Fetch(wallet: ConnectedWallet) {
  const signer = await createSignerFromPrivyWallet(wallet);

  const client = new x402Client();
  registerExactEvmScheme(client, { signer });

  return wrapFetchWithPayment(fetch, client);
}

/**
 * Make a paid request to the x402 endpoint
 * Returns the response data if payment succeeds
 */
export async function makePaymentRequest(
  wallet: ConnectedWallet,
  domain: string = "unknown",
  url: string = "/api"
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  try {
    const fetchWithPayment = await createX402Fetch(wallet);

    console.log("[x402] Making payment request to:", url);
    console.log("[x402] Wallet:", wallet.address, "Domain:", domain);

    const response = await fetchWithPayment(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Wallet-Address": wallet.address,
        "X-Domain": domain,
      },
    });

    console.log("[x402] Response status:", response.status);
    console.log("[x402] Response headers:", Object.fromEntries(response.headers.entries()));

    if (!response.ok) {
      // Check if it's a 402 that wasn't handled
      if (response.status === 402) {
        const paymentHeader = response.headers.get("payment-required");
        if (paymentHeader) {
          try {
            const decoded = JSON.parse(atob(paymentHeader));
            console.log("[x402] Payment requirements:", decoded);
            const payment = decoded.accepts?.[0];
            if (payment) {
              const amount = Number(payment.amount) / 1_000_000; // USDC has 6 decimals
              const network = payment.network === "eip155:84532" ? "Base Sepolia" : payment.network;
              const assetName = payment.extra?.name || "USDC";
              return {
                success: false,
                error: `Payment required: ${amount} ${assetName} on ${network}. Please ensure your wallet has sufficient funds.`,
              };
            }
          } catch {
            // ignore decode error
          }
        }
      }

      const errorData = await response.json().catch(() => ({}));
      console.log("[x402] Error response:", errorData);
      return {
        success: false,
        error: errorData.error || `Request failed with status ${response.status}`,
      };
    }

    const data = await response.json();
    console.log("[x402] Success response:", data);
    return {
      success: true,
      data,
    };
  } catch (error) {
    console.error("[x402] Payment request failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Payment failed",
    };
  }
}

/**
 * Get payment settlement response from headers
 */
export function getPaymentSettlement(
  response: Response,
  client: x402Client
): unknown | null {
  try {
    const httpClient = new x402HTTPClient(client);
    return httpClient.getPaymentSettleResponse(
      (name: string) => response.headers.get(name)
    );
  } catch {
    return null;
  }
}
