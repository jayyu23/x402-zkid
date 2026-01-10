# ZKID Authentication System for x402 Negotiations

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