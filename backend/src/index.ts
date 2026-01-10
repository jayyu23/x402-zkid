import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { isEduDomain, isOrgDomain, getPrice, canNegotiate } from './lib/zkVerifier'
import { chat, chatStream } from './lib/anthropic'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

// Only provide data when user explicitly requests it
function isExplicitDataRequest(message: string): boolean {
  const lower = message.toLowerCase().trim()
  // Only match explicit data requests like "give me the data", "show me the data", "get the data"
  return /\b(give|show|get|send|provide)\s+(me\s+)?(the\s+)?data\b/i.test(lower)
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'x402-zkid-backend' })
})

// Regular chat - always responds with LLM
app.post('/chat', async (req, res) => {
  const { message, domain } = req.body

  if (!message) {
    return res.status(400).json({ error: 'Message is required' })
  }

  try {
    const llmResponse = await chat(message)
    const requestingData = isExplicitDataRequest(message)
    const price = getPrice(domain || 'unknown')

    res.json({
      response: requestingData ? 'Here is your data. Please pay to unlock.' : llmResponse,
      hasData: requestingData,
      ...(requestingData && {
        dataAvailable: true,
        price: price.display,
        cents: price.cents,
        canNegotiate: canNegotiate(domain || 'unknown')
      })
    })
  } catch (error) {
    console.error('Chat error:', error)
    res.status(500).json({ error: 'Failed to generate response' })
  }
})

// Streaming chat endpoint
app.post('/chat/stream', async (req, res) => {
  const { message, domain } = req.body

  if (!message) {
    return res.status(400).json({ error: 'Message is required' })
  }

  // Check if this is a data request first
  const requestingData = isExplicitDataRequest(message)

  if (requestingData) {
    const price = getPrice(domain || 'unknown')
    // For data requests, send metadata then close
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.write(`data: ${JSON.stringify({
      text: 'Here is your data. Please pay to unlock.',
      hasData: true,
      price: price.display,
      cents: price.cents,
      canNegotiate: canNegotiate(domain || 'unknown')
    })}\n\n`)
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
    res.end()
    return
  }

  try {
    await chatStream(message, res)
  } catch (error) {
    console.error('Chat stream error:', error)
    res.status(500).json({ error: 'Failed to generate response' })
  }
})

// Negotiate price - only for edu/org domains
app.post('/negotiate', async (req, res) => {
  const { domain, requestedPrice } = req.body

  if (!canNegotiate(domain)) {
    return res.json({
      success: false,
      message: 'Negotiation not available for your domain. Price is fixed.',
      price: getPrice(domain).display,
      cents: getPrice(domain).cents
    })
  }

  const basePrice = getPrice(domain)
  const minPrice = isEduDomain(domain) ? 1 : (isOrgDomain(domain) ? 1 : 2)
  const requested = parseInt(requestedPrice) || basePrice.cents

  if (requested >= minPrice) {
    return res.json({
      success: true,
      message: `Price accepted: ${requested} cent${requested > 1 ? 's' : ''} USDC`,
      price: `${requested} cent${requested > 1 ? 's' : ''} USDC`,
      cents: requested
    })
  } else {
    return res.json({
      success: false,
      message: `Lowest possible price is ${minPrice} cent USDC for your domain type.`,
      price: `${minPrice} cent USDC`,
      cents: minPrice
    })
  }
})

// Unlock/pay for data
app.post('/unlock', async (req, res) => {
  const { domain, pricePaid } = req.body

  // Placeholder - in real implementation, verify payment here
  res.json({
    success: true,
    data: 'DATA',
    message: 'Payment received! Here is your data.'
  })
})

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`)
})
