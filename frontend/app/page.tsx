'use client'

import { usePrivy, useWallets } from '@privy-io/react-auth'
import { useState, useEffect } from 'react'
import { generateZKProof, verifyZKProof, ProofData } from '@/lib/zkproof'
import { sendChat, unlockData } from '@/lib/api'

interface Message {
  role: 'user' | 'assistant'
  content: string
  hasData?: boolean
  price?: string
  cents?: number
  canNegotiate?: boolean
  unlocked?: boolean
  data?: string
}

export default function Home() {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy()
  const { wallets } = useWallets()
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: 'Welcome to x402 ZKID! You are now authenticated. Your identity has been verified and bound to your wallet. You can download your ZK proof above, or start negotiating below.',
    },
  ])
  const [input, setInput] = useState('')
  const [zkProof, setZkProof] = useState<ProofData | null>(null)
  const [isGeneratingProof, setIsGeneratingProof] = useState(false)
  const [proofError, setProofError] = useState<string | null>(null)
  const [isVerified, setIsVerified] = useState<boolean | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [currentPrice, setCurrentPrice] = useState<{ price: string; cents: number } | null>(null)

  const embeddedWallet = wallets.find((w) => w.walletClientType === 'privy')

  useEffect(() => {
    if (authenticated && user && embeddedWallet?.address) {
      generateProof()
    }
  }, [authenticated, user, embeddedWallet?.address])

  const generateProof = async () => {
    if (!user || !embeddedWallet?.address) return

    setIsGeneratingProof(true)
    setProofError(null)
    setIsVerified(null)

    try {
      const accessToken = await getAccessToken()
      if (!accessToken) {
        throw new Error('Failed to get access token')
      }

      // Decode JWT to extract claims
      const parts = accessToken.split('.')
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format')
      }

      const payload = JSON.parse(atob(parts[1]))

      // Extract email from linked accounts
      const googleAccount = user.linkedAccounts?.find(
        (account) => account.type === 'google_oauth'
      )
      const email = googleAccount?.email || user.email?.address || null
      const domain = email ? email.split('@')[1] : 'unknown'

      // Generate real ZK proof using snarkjs
      const proof = await generateZKProof(
        domain,
        embeddedWallet.address,
        payload.exp
      )

      setZkProof(proof)

      // Verify the proof
      const verified = await verifyZKProof(proof)
      setIsVerified(verified)
      console.log('Proof verification result:', verified)

    } catch (error) {
      console.error('Failed to generate proof:', error)
      setProofError(
        error instanceof Error ? error.message : 'Failed to generate proof'
      )

      // Check if it's a missing circuit files error
      if (error instanceof Error && error.message.includes('fetch')) {
        setProofError(
          'Circuit files not found. Please run: cd circuits && pnpm install && pnpm build'
        )
      }
    } finally {
      setIsGeneratingProof(false)
    }
  }

  const downloadProof = () => {
    if (!zkProof) return

    const blob = new Blob([JSON.stringify(zkProof, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `zkid-proof-${Date.now()}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const downloadRawJwt = async () => {
    const accessToken = await getAccessToken()
    if (!accessToken) return

    const blob = new Blob([accessToken], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `privy-jwt-${Date.now()}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handleSend = async () => {
    if (!input.trim() || !zkProof) return

    const userMessage: Message = { role: 'user', content: input }
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const result = await sendChat(input, zkProof.domain)

      const assistantMessage: Message = {
        role: 'assistant',
        content: result.response,
        hasData: result.hasData,
        price: result.price,
        cents: result.cents,
        canNegotiate: result.canNegotiate,
        unlocked: false
      }
      setMessages((prev) => [...prev, assistantMessage])

      if (result.hasData && result.price) {
        setCurrentPrice({ price: result.price, cents: result.cents || 2 })
      }
    } catch (error) {
      console.error('Chat error:', error)
      const errorMessage: Message = {
        role: 'assistant',
        content: 'Error connecting to server. Please try again.'
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const handlePay = async (messageIndex: number) => {
    if (!zkProof || !currentPrice) return

    setIsLoading(true)
    try {
      const result = await unlockData(zkProof.domain, currentPrice.cents)

      if (result.success) {
        setMessages((prev) => prev.map((msg, i) =>
          i === messageIndex
            ? { ...msg, unlocked: true, data: result.data }
            : msg
        ))
        setCurrentPrice(null)
      }
    } catch (error) {
      console.error('Payment error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  if (!ready) {
    return <div className="loading">Loading...</div>
  }

  if (!authenticated) {
    return (
      <div className="login-container">
        <h1>x402 ZKID</h1>
        <p>
          Authenticate with your Google account to generate a zero-knowledge proof
          binding your identity to an embedded wallet.
        </p>
        <button className="btn btn-primary" onClick={login}>
          Sign in with Google
        </button>
      </div>
    )
  }

  const email =
    user?.linkedAccounts?.find((a) => a.type === 'google_oauth')?.email ||
    user?.email?.address ||
    'Unknown'

  return (
    <div className="container">
      <header className="header">
        <h1>x402 ZKID</h1>
        <div className="user-info">
          <span className="user-email">{email}</span>
          {embeddedWallet && (
            <span className="wallet-address">
              {embeddedWallet.address.slice(0, 6)}...{embeddedWallet.address.slice(-4)}
            </span>
          )}
          <button className="btn btn-secondary" onClick={logout}>
            Sign out
          </button>
        </div>
      </header>

      <section className="proof-section">
        <div className="proof-header">
          <h2>Identity Proof</h2>
          {zkProof && !zkProof.isReal && (
            <span className="mock-hint">demo</span>
          )}
        </div>
        {isGeneratingProof ? (
          <div className="proof-loading">
            <span className="spinner"></span>
            <div>
              <p>Generating ZK proof...</p>
              <p className="proof-loading-hint">This may take a few seconds</p>
            </div>
          </div>
        ) : proofError ? (
          <div className="proof-error">
            <p>Error: {proofError}</p>
            <button className="btn btn-secondary" onClick={generateProof}>
              Retry
            </button>
          </div>
        ) : zkProof ? (
          <>
            <div className="proof-info">
              <div className="proof-item">
                <label>Status</label>
                <span className={`status-badge ${isVerified ? 'status-verified' : 'status-pending'}`}>
                  {isVerified === null ? 'Verifying...' : isVerified ? 'Verified' : 'Invalid'}
                </span>
              </div>
              <div className="proof-item">
                <label>Domain</label>
                <span>{zkProof.domain}</span>
              </div>
              <div className="proof-item">
                <label>Wallet</label>
                <span className="wallet-mono">{zkProof.walletAddress}</span>
              </div>
              <div className="proof-item">
                <label>Protocol</label>
                <span>{zkProof.proof.protocol} / {zkProof.proof.curve}</span>
              </div>
            </div>
            <div className="proof-actions">
              <button className="btn btn-primary" onClick={downloadProof}>
                Download Proof
              </button>
              <button className="btn btn-secondary" onClick={downloadRawJwt}>
                Download JWT
              </button>
              <button
                className="btn btn-generate"
                onClick={generateProof}
                disabled={isGeneratingProof}
              >
                {isGeneratingProof ? 'Generating...' : 'Regenerate'}
              </button>
            </div>
          </>
        ) : (
          <div className="proof-waiting">
            <p>Waiting for wallet...</p>
          </div>
        )}
      </section>

      <div className="chat-container">
        <div className="messages">
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`message ${
                msg.role === 'user' ? 'message-user' : 'message-assistant'
              }`}
            >
              <div>{msg.content}</div>
              {msg.hasData && msg.role === 'assistant' && (
                <div className="data-actions" style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                  {msg.unlocked ? (
                    <div>
                      <div style={{ color: '#10b981', marginBottom: '0.5rem' }}>Unlocked!</div>
                      <div style={{ fontFamily: 'monospace', background: '#000', padding: '1rem', borderRadius: '4px' }}>
                        {msg.data}
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        className="btn btn-secondary"
                        disabled
                        style={{ opacity: 0.5 }}
                      >
                        Download (Locked)
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={() => handlePay(i)}
                        disabled={isLoading}
                      >
                        {isLoading ? 'Processing...' : `Pay ${msg.price} to Unlock`}
                      </button>
                      {msg.canNegotiate && (
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          (You can negotiate!)
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="input-container">
          <input
            type="text"
            placeholder="Chat or ask for data..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleSend()}
            disabled={isLoading}
          />
          <button
            className="btn btn-primary"
            onClick={handleSend}
            disabled={isLoading || !zkProof}
          >
            {isLoading ? '...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  )
}
