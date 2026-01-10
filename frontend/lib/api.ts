const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'

interface ChatResponse {
  response: string
  hasData?: boolean
  dataAvailable?: boolean
  price?: string
  cents?: number
  canNegotiate?: boolean
  error?: string
}

interface StreamChunk {
  text?: string
  done?: boolean
  hasData?: boolean
  price?: string
  cents?: number
  canNegotiate?: boolean
}

interface NegotiateResponse {
  success: boolean
  message: string
  price: string
  cents: number
}

interface UnlockResponse {
  success: boolean
  data: string
  message: string
}

export async function sendChat(message: string, domain: string): Promise<ChatResponse> {
  const res = await fetch(`${API_URL}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, domain })
  })
  return res.json()
}

export async function sendChatStream(
  message: string,
  domain: string,
  onChunk: (chunk: StreamChunk) => void
): Promise<void> {
  const res = await fetch(`${API_URL}/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, domain })
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

export async function negotiate(domain: string, requestedPrice: number): Promise<NegotiateResponse> {
  const res = await fetch(`${API_URL}/negotiate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, requestedPrice })
  })
  return res.json()
}

export async function unlockData(domain: string, pricePaid: number): Promise<UnlockResponse> {
  const res = await fetch(`${API_URL}/unlock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ domain, pricePaid })
  })
  return res.json()
}
