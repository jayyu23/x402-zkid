import express from 'express'
import cors from 'cors'
import dotenv from 'dotenv'
import { getStartingPrice } from './lib/zkVerifier'
import { runNegotiationAgent, getCurrentPrice, pricingState } from './agent/negotiationAgent'
import zkidRouter from './zkid/routes'

dotenv.config()

const app = express()
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json())

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'x402-zkid-backend' })
})

// Get current price for a wallet (used by x402 endpoint)
app.get('/api/price/:walletAddress', (req, res) => {
  const { walletAddress } = req.params
  const { domain } = req.query

  if (!walletAddress) {
    return res.status(400).json({ error: 'Wallet address is required' })
  }

  const domainStr = (domain as string) || 'unknown'
  const price = getCurrentPrice(walletAddress, domainStr)

  res.json({
    walletAddress,
    domain: domainStr,
    cents: price.cents,
    dollars: (price.cents / 100).toFixed(2),
    round: price.round
  })
})

// Agent-based chat endpoint (replaces old /chat/stream)
app.post('/chat/agent', async (req, res) => {
  const { message, walletAddress, domain } = req.body

  if (!message) {
    return res.status(400).json({ error: 'Message is required' })
  }

  if (!walletAddress) {
    return res.status(400).json({ error: 'Wallet address is required' })
  }

  const domainStr = domain || 'unknown'

  try {
    console.log(`[Agent] Processing message from ${walletAddress} (${domainStr}): "${message}"`)

    const result = await runNegotiationAgent(message, walletAddress, domainStr)

    console.log(`[Agent] Response sent, current price: $${result.currentPrice.dollars}, isDataOffer: ${result.isDataOffer}`)

    res.json({
      response: result.response,
      currentPrice: result.currentPrice,
      isDataOffer: result.isDataOffer
    })
  } catch (error) {
    console.error('[Agent] Error:', error)
    res.status(500).json({
      error: 'Agent failed to process message',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})

// Streaming agent chat (SSE version)
app.post('/chat/stream', async (req, res) => {
  const { message, walletAddress, domain } = req.body

  if (!message) {
    return res.status(400).json({ error: 'Message is required' })
  }

  if (!walletAddress) {
    return res.status(400).json({ error: 'Wallet address is required' })
  }

  const domainStr = domain || 'unknown'

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  try {
    console.log(`[Agent Stream] Processing message from ${walletAddress} (${domainStr}): "${message}"`)

    const result = await runNegotiationAgent(message, walletAddress, domainStr)

    // Send the full response as a single SSE event
    res.write(`data: ${JSON.stringify({
      text: result.response,
      currentPrice: result.currentPrice,
      isDataOffer: result.isDataOffer
    })}\n\n`)

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
    res.end()

    console.log(`[Agent Stream] Response sent, current price: $${result.currentPrice.dollars}, isDataOffer: ${result.isDataOffer}`)
  } catch (error) {
    console.error('[Agent Stream] Error:', error)
    res.write(`data: ${JSON.stringify({
      text: 'Sorry, something went wrong. Please try again.',
      error: true
    })}\n\n`)
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`)
    res.end()
  }
})

// Legacy endpoints for backwards compatibility
app.post('/chat', async (req, res) => {
  const { message, walletAddress, domain } = req.body

  if (!message) {
    return res.status(400).json({ error: 'Message is required' })
  }

  const domainStr = domain || 'unknown'
  const wallet = walletAddress || 'anonymous'

  try {
    const result = await runNegotiationAgent(message, wallet, domainStr)
    res.json({
      response: result.response,
      currentPrice: result.currentPrice,
      isDataOffer: result.isDataOffer
    })
  } catch (error) {
    console.error('Chat error:', error)
    res.status(500).json({ error: 'Failed to generate response' })
  }
})

// Unlock/pay for data
app.post('/unlock', async (req, res) => {
  const { walletAddress } = req.body

  // Get the negotiated price for this wallet
  const state = pricingState.get(walletAddress)
  const pricePaid = state?.cents || 10

  res.json({
    success: true,
    data: 'Here is your premium data! This is the secret information you paid for.',
    message: `Payment of $${(pricePaid / 100).toFixed(2)} received! Here is your data.`,
    pricePaid: {
      cents: pricePaid,
      dollars: (pricePaid / 100).toFixed(2)
    }
  })
})

// ZKID proof storage routes
app.use('/zkid', zkidRouter)

app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`)
  console.log(`Negotiation agent ready!`)
})
