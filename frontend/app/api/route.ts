import { NextRequest, NextResponse } from "next/server";
import { createThirdwebClient } from "thirdweb";
import { facilitator, settlePayment } from "thirdweb/x402";
import { baseSepolia } from "thirdweb/chains";

// Create Thirdweb client using secret key from environment variables
const client = createThirdwebClient({
  secretKey: process.env.THIRDWEB_SECRET_KEY!,
});

// Create facilitator instance
const facilitatorInstance = facilitator({
  client,
  walletAddress: process.env.THIRDWEB_SERVER_WALLET_ADDRESS!,
  chain: baseSepolia,
});

export async function GET(request: NextRequest) {
  try {
    // Extract the x-payment header from the request
    const paymentHeader = request.headers.get("x-payment");

    if (!paymentHeader) {
      return NextResponse.json(
        { error: "Missing x-payment header" },
        { status: 402 }
      );
    }

    // Settle the payment using the x402 payment header
    const settlementResult = await settlePayment({
      facilitator: facilitatorInstance,
      paymentHeader,
    });

    // Return success response with settlement details
    return NextResponse.json({
      success: true,
      settlement: settlementResult,
      message: "Payment processed successfully",
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
