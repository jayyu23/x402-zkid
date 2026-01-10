import { createPublicClient, http, formatEther, formatUnits } from 'viem'
import { baseSepolia } from 'viem/chains'

// Base Sepolia USDC contract address
const USDC_ADDRESS = '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const

// ERC20 ABI for balanceOf
const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(),
})

export interface Balances {
  eth: string
  usdc: string
  ethRaw: bigint
  usdcRaw: bigint
}

export async function getBalances(address: string): Promise<Balances> {
  const [ethBalance, usdcBalance] = await Promise.all([
    publicClient.getBalance({ address: address as `0x${string}` }),
    publicClient.readContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    }),
  ])

  return {
    eth: formatEther(ethBalance),
    usdc: formatUnits(usdcBalance, 6), // USDC has 6 decimals
    ethRaw: ethBalance,
    usdcRaw: usdcBalance,
  }
}

export const FAUCETS = {
  eth: 'https://www.alchemy.com/faucets/base-sepolia',
  usdc: 'https://faucet.circle.com/',
}

export const USDC_CONTRACT = USDC_ADDRESS
