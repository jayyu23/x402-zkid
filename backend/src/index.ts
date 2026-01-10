import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { isEduDomain, isOrgDomain, getPrice, canNegotiate } from './lib/zkVerifier'
import { chat } from './lib/anthropic'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

// Keywords that trigger data request
const DATA_KEYWORDS = ['syllabus', 'course', 'download', 'data', 'document', 'file', 'access', 'get']

function isDataRequest(message: string): boolean {
  const lower = message.toLowerCase()
  return DATA_KEYWORDS.some(keyword => lower.includes(keyword))
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
    const requestingData = isDataRequest(message)
    const price = getPrice(domain || 'unknown')

    res.json({
      response: llmResponse,
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
