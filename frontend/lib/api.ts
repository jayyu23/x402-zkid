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
