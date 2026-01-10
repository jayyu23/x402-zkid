# ZKID Authentication System for x402 Negotiations

## Overview

ZKID Auth Server
- Use Privy to Generate Google OAuth Wallet. Get a JWT, extract the domain information.
- Run a Zero Knowledge Proof over the JWT to get a downloadable ZK proof that a wallet binds to some domain.

x402 Backend API
- The client will send request for premium resource (eg. a document/endpoint). Server responds with 402. Client will respond with ZKP Auth + the x402 payment payload. Only goes through if the ZKP validation is OK.
- The backend API keeps a MongoDB Atlas server that keeps track of nonces to prevent replay attacks
- For testing this should all occur on Base testnet

Extensions:
- We can then do auth-gated documents (eg. ones that require a particular domain to access), whitelisted/blacklisted domains etc. All done through the MongoDB
- Do a conversation/inference interface using Fireworks AI. After authing, the user will "negotiate" with the server for a price.

---

## Setup

### Prerequisites
- Node.js 18+
- pnpm (`npm install -g pnpm`)
- Privy account (https://dashboard.privy.io)

### 1. Configure Privy

1. Create an app at https://dashboard.privy.io
2. Enable Google OAuth in Login Methods
3. Add `http://localhost:3000` to Allowed Origins
4. Copy your App ID

### 2. Set Environment Variables

```bash
cp frontend/.env.example frontend/.env.local
# Edit frontend/.env.local and add your Privy App ID
```

### 3. Run the Project

```bash
make          # Install deps and start (uses mock proofs by default)
```

### 4. (Optional) Enable Real ZK Proofs

To generate cryptographically valid proofs that can be verified on-chain:

```bash
# Install circom first
brew install circom    # macOS
# Or: https://docs.circom.io/getting-started/installation/

# Build circuits
make circom
```

After running `make circom`, the app automatically detects the circuit files and generates real proofs.

### 5. Stop Services

```bash
make stop
```

---

## ZK Proof Modes

### Mock Mode (Default)
- **No circom required**
- Generates proof structure with random values
- Public signals use real Poseidon hashes
- Good for development and testing UI

### Real Mode (Optional)
- **Requires circom installed**
- Run `make circom` to compile circuits
- Generates cryptographically valid Groth16 proofs
- Proofs can be verified on-chain

The app automatically detects which mode to use based on whether circuit files exist in `frontend/public/zk/`.

---

## Project Structure

```
x402-zkid/
├── Makefile              # Build orchestration
├── package.json          # Root package
├── circuits/             # ZK circuits (optional)
│   ├── jwt_domain_verifier.circom
│   └── build.js          # Circuit compiler
├── frontend/             # Next.js app
│   ├── app/
│   │   ├── page.tsx      # Main page
│   │   ├── layout.tsx    # Root layout
│   │   └── globals.css   # Styles
│   ├── lib/
│   │   └── zkproof.ts    # Dual-mode proof generation
│   ├── public/zk/        # Circuit artifacts (after make circom)
│   └── components/
│       └── Providers.tsx # Privy wrapper
└── backend/              # Express.js API
    └── src/
        └── index.ts      # Server
```

---

## Public Signals

The ZK proof exposes three public signals:
- `domainHash`: Poseidon hash of the email domain
- `nullifier`: Unique identifier (domain + secret)
- `walletBinding`: Hash binding wallet to domain

---

## Ports
- Frontend: http://localhost:3000
- Backend: http://localhost:3001
