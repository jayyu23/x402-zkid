const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

interface CurrentPrice {
  cents: number
  dollars: string
}

interface ChatResponse {
  response: string
  currentPrice?: CurrentPrice
  canNegotiate?: boolean
  error?: string
}

interface StreamChunk {
  text?: string
  done?: boolean
  currentPrice?: CurrentPrice
  isDataOffer?: boolean
  error?: boolean
}

interface UnlockResponse {
  success: boolean
  data: string
  message: string
  pricePaid?: CurrentPrice
}

export async function sendChat(
  message: string,
  walletAddress: string,
  domain: string
): Promise<ChatResponse> {
  const res = await fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, walletAddress, domain })
  })
  return res.json()
}

export async function sendChatStream(
  message: string,
  walletAddress: string,
  domain: string,
  onChunk: (chunk: StreamChunk) => void
): Promise<void> {
  const res = await fetch(`${API_URL}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, walletAddress, domain })
  })

  if (!res.ok) {
    throw new Error('Failed to connect to chat stream')
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No reader available')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.slice(6)) as StreamChunk
          onChunk(data)
        } catch {
          // Skip invalid JSON
        }
      }
    }
  }
}

export async function unlockData(walletAddress: string): Promise<UnlockResponse> {
  const res = await fetch(`${API_URL}/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ walletAddress })
  })
  return res.json()
}

// Get current price for a wallet
export async function getCurrentPrice(
  walletAddress: string,
  domain: string
): Promise<CurrentPrice> {
  const url = new URL(`${API_URL}/api/price/${walletAddress}`)
  url.searchParams.set('domain', domain)

  const res = await fetch(url.toString())
  if (!res.ok) {
    return { cents: 10, dollars: '0.10' }
  }

  const data = await res.json()
  return {
    cents: data.cents,
    dollars: data.dollars
  }
}
