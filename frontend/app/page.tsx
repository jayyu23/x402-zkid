'use client'

import { usePrivy, useWallets } from '@privy-io/react-auth'
import { useState, useEffect, useRef, useCallback } from 'react'
import { generateZKProof, verifyZKProof, ProofData } from '@/lib/zkproof'
import { sendChatStream } from '@/lib/api'
import { makePaymentRequest } from '@/lib/x402client'
import { sendChatStream, unlockData } from '@/lib/api'
import { getBalances, Balances, FAUCETS } from '@/lib/balance'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Message {
  role: 'user' | 'assistant'
  content: string
  hasData?: boolean
  price?: string
  cents?: number
  canNegotiate?: boolean
  unlocked?: boolean
  data?: string
  isStreaming?: boolean
}

export default function Home() {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy()
  const { wallets } = useWallets()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [zkProof, setZkProof] = useState<ProofData | null>(null)
  const [isGeneratingProof, setIsGeneratingProof] = useState(false)
  const [proofError, setProofError] = useState<string | null>(null)
  const [isVerified, setIsVerified] = useState<boolean | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [currentPrice, setCurrentPrice] = useState<{ price: string; cents: number } | null>(null)
  const [copied, setCopied] = useState(false)
  const [balances, setBalances] = useState<Balances | null>(null)
  const [showFundModal, setShowFundModal] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const embeddedWallet = wallets.find((w) => w.walletClientType === 'privy')

  const copyWalletAddress = async () => {
    if (!embeddedWallet?.address) return
    await navigator.clipboard.writeText(embeddedWallet.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const fetchBalances = useCallback(async () => {
    if (!embeddedWallet?.address) return
    try {
      const bal = await getBalances(embeddedWallet.address)
      setBalances(bal)
    } catch (error) {
      console.error('Failed to fetch balances:', error)
    }
  }, [embeddedWallet?.address])

  useEffect(() => {
    if (embeddedWallet?.address) {
      fetchBalances()
      // Refresh balances every 30 seconds
      const interval = setInterval(fetchBalances, 30000)
      return () => clearInterval(interval)
    }
  }, [embeddedWallet?.address, fetchBalances])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

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

      const parts = accessToken.split('.')
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format')
      }

      const payload = JSON.parse(atob(parts[1]))

      const googleAccount = user.linkedAccounts?.find(
        (account) => account.type === 'google_oauth'
      )
      const email = googleAccount?.email || user.email?.address || null
      const domain = email ? email.split('@')[1] : 'unknown'

      const proof = await generateZKProof(
        domain,
        embeddedWallet.address,
        payload.exp
      )

      setZkProof(proof)

      const verified = await verifyZKProof(proof)
      setIsVerified(verified)
      console.log('Proof verification result:', verified)
      console.log('Proof data:', {
        walletAddress: proof.walletAddress,
        domain: proof.domain,
        method: proof.method,
        generatedAt: proof.generatedAt,
        hasProof: !!proof.proof,
        publicSignalsCount: proof.publicSignals?.length || 0,
      })

      // Store proof in MongoDB Atlas (always try to store, even if verification fails for now)
      try {
        console.log('Attempting to store proof in MongoDB...')
        const response = await fetch('http://localhost:3001/zkid/proofs', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            walletAddress: proof.walletAddress,
            domain: proof.domain,
            method: proof.method,
            generatedAt: proof.generatedAt,
            proof: proof.proof,
            publicSignals: proof.publicSignals,
          }),
        })

        console.log('Response status:', response.status, response.statusText)

        if (response.ok) {
          const result = await response.json()
          console.log('✅ Proof stored in MongoDB:', result)
        } else {
          const error = await response.json().catch(() => ({ error: 'Unknown error' }))
          console.error('❌ Failed to store proof:', response.status, error)
        }
      } catch (storageError) {
        console.error('❌ Error storing proof to MongoDB:', storageError)
        // Don't fail the whole flow if storage fails
      }
    } catch (error) {
      console.error('Failed to generate proof:', error)
      setProofError(
        error instanceof Error ? error.message : 'Failed to generate proof'
      )

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

  const handleSend = async () => {
    if (!input.trim() || !zkProof || isLoading) return

    const userMessage: Message = { role: 'user', content: input }
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    // Add empty assistant message for streaming
    const assistantMessage: Message = {
      role: 'assistant',
      content: '',
      isStreaming: true
    }
    setMessages((prev) => [...prev, assistantMessage])

    try {
      let streamedContent = ''
      let dataInfo: { hasData?: boolean; price?: string; cents?: number; canNegotiate?: boolean } = {}

      await sendChatStream(input, zkProof.domain, (chunk) => {
        if (chunk.done) {
          setMessages((prev) =>
            prev.map((msg, i) =>
              i === prev.length - 1
                ? {
                    ...msg,
                    isStreaming: false,
                    hasData: dataInfo.hasData,
                    price: dataInfo.price,
                    cents: dataInfo.cents,
                    canNegotiate: dataInfo.canNegotiate
                  }
                : msg
            )
          )
          if (dataInfo.hasData && dataInfo.price) {
            setCurrentPrice({ price: dataInfo.price, cents: dataInfo.cents || 2 })
          }
        } else if (chunk.text) {
          streamedContent += chunk.text
          if (chunk.hasData) {
            dataInfo = {
              hasData: chunk.hasData,
              price: chunk.price,
              cents: chunk.cents,
              canNegotiate: chunk.canNegotiate
            }
          }
          setMessages((prev) =>
            prev.map((msg, i) =>
              i === prev.length - 1
                ? { ...msg, content: streamedContent }
                : msg
            )
          )
        }
      })
    } catch (error) {
      console.error('Chat error:', error)
      setMessages((prev) =>
        prev.map((msg, i) =>
          i === prev.length - 1
            ? { ...msg, content: 'Error connecting to server. Please try again.', isStreaming: false }
            : msg
        )
      )
    } finally {
      setIsLoading(false)
    }
  }

  const handlePay = async (messageIndex: number) => {
    if (!embeddedWallet || !currentPrice) return

    setIsLoading(true)
    try {
      // Use x402 payment flow with Privy wallet
      const result = await makePaymentRequest(embeddedWallet)

      if (result.success && result.data) {
        const responseData = result.data as { data?: { timestamp?: string }; message?: string }
        setMessages((prev) => prev.map((msg, i) =>
          i === messageIndex
            ? {
                ...msg,
                unlocked: true,
                data: responseData.message || JSON.stringify(responseData.data)
              }
            : msg
        ))
        setCurrentPrice(null)
      } else {
        console.error('Payment failed:', result.error)
        // Show error to user
        setMessages((prev) => prev.map((msg, i) =>
          i === messageIndex
            ? { ...msg, content: msg.content + `\n\nPayment error: ${result.error}` }
            : msg
        ))
      }
    } catch (error) {
      console.error('Payment error:', error)
    } finally {
      setIsLoading(false)
    }
  }

  if (!ready) {
    return (
      <div className="app-container">
        <div className="loading-state">
          <div className="loading-spinner" />
          <span>Loading...</span>
        </div>
      </div>
    )
  }

  if (!authenticated) {
    return (
      <div className="app-container">
        <div className="login-view">
          <div className="login-card">
            <div className="login-header">
              <h1>x402</h1>
              <span className="login-badge">ZKID</span>
            </div>
            <p className="login-description">
              Authenticate with Google to generate a zero-knowledge proof binding your identity to an embedded wallet.
            </p>
            <button className="login-button" onClick={login}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>
          </div>
        </div>
      </div>
    )
  }

  const email =
    user?.linkedAccounts?.find((a) => a.type === 'google_oauth')?.email ||
    user?.email?.address ||
    'Unknown'

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1 className="logo">x402</h1>
          <span className="logo-badge">ZKID</span>
        </div>

        {/* Identity Card */}
        <div className="identity-card">
          <div className="identity-header">
            <span className="identity-label">Identity</span>
            {isVerified && <span className="verified-badge">Verified</span>}
          </div>
          <div className="identity-email">{email}</div>
          {embeddedWallet && (
            <>
              <div className="wallet-row">
                <div className="identity-wallet">
                  {embeddedWallet.address.slice(0, 6)}...{embeddedWallet.address.slice(-4)}
                </div>
                <button className="copy-btn" onClick={copyWalletAddress} title="Copy address">
                  {copied ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </button>
              </div>
              <div className="chain-badge">Base Sepolia</div>
            </>
          )}
        </div>

        {/* Balance Card */}
        <div className="balance-card">
          <div className="balance-header">
            <span className="balance-label">Balance</span>
            <button className="refresh-btn" onClick={fetchBalances} title="Refresh">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            </button>
          </div>
          {balances ? (
            <div className="balance-amounts">
              <div className="balance-row">
                <span className="balance-token">ETH</span>
                <span className="balance-value">{parseFloat(balances.eth).toFixed(4)}</span>
              </div>
              <div className="balance-row">
                <span className="balance-token">USDC</span>
                <span className="balance-value">{parseFloat(balances.usdc).toFixed(2)}</span>
              </div>
            </div>
          ) : (
            <div className="balance-loading">Loading...</div>
          )}
          <button className="add-funds-btn" onClick={() => setShowFundModal(true)}>
            Add Funds
          </button>
        </div>

        {/* Proof Section */}
        <div className="proof-card">
          <div className="proof-label">ZK Proof</div>
          {isGeneratingProof ? (
            <div className="proof-generating">
              <div className="loading-spinner small" />
              <span>Generating...</span>
            </div>
          ) : proofError ? (
            <div className="proof-error-compact">
              <span>Error</span>
              <button onClick={generateProof}>Retry</button>
            </div>
          ) : zkProof ? (
            <div className="proof-ready">
              <div className="proof-meta">
                <span className="proof-protocol">{zkProof.proof.protocol}</span>
                {!zkProof.isReal && <span className="demo-tag">demo</span>}
              </div>
              <button className="download-btn" onClick={downloadProof}>
                Download Proof
              </button>
            </div>
          ) : (
            <div className="proof-waiting">Waiting...</div>
          )}
        </div>

        <div className="sidebar-spacer" />

        <button className="logout-btn" onClick={logout}>
          Sign out
        </button>
      </aside>

      {/* Main Chat Area */}
      <main className="chat-main">
        <div className="messages-container">
          {messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <h2>Start a conversation</h2>
              <p>Ask anything, or say &quot;give me the data&quot; to request paid content.</p>
            </div>
          ) : (
            <div className="messages-list">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`message ${msg.role === 'user' ? 'message-user' : 'message-assistant'}`}
                >
                  {msg.role === 'assistant' && (
                    <div className="message-avatar">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                      </svg>
                    </div>
                  )}
                  <div className="message-content">
                    <div className="message-text markdown-content">
                      {msg.role === 'assistant' ? (
                        <>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                          {msg.isStreaming && <span className="cursor" />}
                        </>
                      ) : (
                        msg.content
                      )}
                    </div>
                    {msg.hasData && msg.role === 'assistant' && (
                      <div className="data-unlock-card">
                        {msg.unlocked ? (
                          <div className="data-unlocked">
                            <div className="unlocked-header">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                              Unlocked
                            </div>
                            <div className="data-content">{msg.data}</div>
                          </div>
                        ) : (
                          <div className="data-locked">
                            <div className="locked-info">
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                              </svg>
                              <span>Data available</span>
                            </div>
                            <button
                              className="pay-button"
                              onClick={() => handlePay(i)}
                              disabled={isLoading || !embeddedWallet}
                            >
                              {isLoading ? 'Processing...' : `Pay ${msg.price}`}
                            </button>
                            {msg.canNegotiate && (
                              <span className="negotiate-hint">Negotiable</span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* Input Area */}
        <div className="input-area">
          <div className="input-wrapper">
            <input
              type="text"
              placeholder="Type a message..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isLoading && handleSend()}
              disabled={isLoading || !zkProof}
            />
            <button
              className="send-button"
              onClick={handleSend}
              disabled={isLoading || !zkProof || !input.trim()}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      </main>

      {/* Add Funds Modal */}
      {showFundModal && (
        <div className="modal-overlay" onClick={() => setShowFundModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Add Funds</h3>
              <button className="modal-close" onClick={() => setShowFundModal(false)}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-description">
                Get testnet tokens on Base Sepolia to use the x402 payment system.
              </p>

              <div className="fund-option">
                <div className="fund-option-header">
                  <span className="fund-token">ETH</span>
                  <span className="fund-network">Base Sepolia</span>
                </div>
                <p className="fund-option-desc">Required for gas fees</p>
                <a
                  href={FAUCETS.eth}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="fund-link-btn"
                >
                  Get ETH from Faucet
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              </div>

              <div className="fund-option">
                <div className="fund-option-header">
                  <span className="fund-token">USDC</span>
                  <span className="fund-network">Base Sepolia</span>
                </div>
                <p className="fund-option-desc">Required for x402 payments</p>
                <a
                  href={FAUCETS.usdc}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="fund-link-btn"
                >
                  Get USDC from Circle Faucet
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                </a>
              </div>

              <div className="fund-wallet-info">
                <span className="fund-wallet-label">Your wallet address:</span>
                <code className="fund-wallet-address">{embeddedWallet?.address}</code>
                <button className="copy-btn" onClick={copyWalletAddress}>
                  {copied ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
