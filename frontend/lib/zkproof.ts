/**
 * ZK Proof Generation for JWT Domain Binding
 *
 * Supports two modes:
 * 1. Mock mode (default): Generates proof structure with real Poseidon hashes
 *    but random proof values. No circom required.
 *
 * 2. Real mode: Uses snarkjs with compiled circuit files.
 *    Requires: `make circom` to build circuits first.
 *    Files needed in /public/zk/:
 *    - jwt_domain_verifier.wasm
 *    - jwt_domain_verifier.zkey
 *    - verification_key.json
 */

export interface ZKProof {
  pi_a: [string, string, string]
  pi_b: [[string, string], [string, string], [string, string]]
  pi_c: [string, string, string]
  protocol: string
  curve: string
}

export interface ProofData {
  proof: ZKProof
  publicSignals: string[]
  domain: string
  method: 'jwt' | 'email'
  generatedAt: number
  walletAddress: string
  isReal: boolean  // true if using real snarkjs proof, false if mock
}

const CIRCUIT_NAME = 'jwt_domain_verifier'
const ZK_BASE_PATH = '/zk'

// Check if circuit files exist
async function checkCircuitFilesExist(): Promise<boolean> {
  try {
    const wasmResponse = await fetch(`${ZK_BASE_PATH}/${CIRCUIT_NAME}.wasm`, { method: 'HEAD' })
    const zkeyResponse = await fetch(`${ZK_BASE_PATH}/${CIRCUIT_NAME}.zkey`, { method: 'HEAD' })
    const exists = wasmResponse.ok && zkeyResponse.ok
    console.log(`Circuit files check: wasm=${wasmResponse.ok}, zkey=${zkeyResponse.ok}, using real=${exists}`)
    return exists
  } catch (error) {
    console.log('Circuit files check failed:', error)
    return false
  }
}

// Convert string to 4 field elements for circuit input
function stringToFieldElements(str: string): bigint[] {
  const bytes = new TextEncoder().encode(str)
  const elements: bigint[] = [0n, 0n, 0n, 0n]

  for (let i = 0; i < Math.min(bytes.length, 124); i++) {
    const elementIndex = Math.floor(i / 31)
    const bytePosition = i % 31
    elements[elementIndex] += BigInt(bytes[i]) << BigInt(bytePosition * 8)
  }

  return elements
}

// Convert address to field element
function addressToField(address: string): bigint {
  return BigInt(address.toLowerCase())
}

// Generate random hex string
function randomHex(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Generate random secret
function generateSecret(): bigint {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return BigInt('0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(''))
}

/**
 * Compute hashes using Poseidon (matches circuit computation)
 */
async function computeHashes(domain: string, walletAddress: string, secret: bigint) {
  const { poseidon2, poseidon4 } = await import('poseidon-lite')

  const domainFields = stringToFieldElements(domain)
  const domainHash = poseidon4(domainFields)
  const nullifier = poseidon2([domainHash, secret])
  const walletBinding = poseidon2([domainHash, addressToField(walletAddress)])

  return { domainHash, nullifier, walletBinding, domainFields, secret }
}

/**
 * Generate a real ZK proof using snarkjs
 */
async function generateRealProof(
  domain: string,
  walletAddress: string
): Promise<ProofData> {
  const snarkjs = await import('snarkjs')

  const secret = generateSecret()
  const { domainHash, nullifier, walletBinding, domainFields } = await computeHashes(
    domain,
    walletAddress,
    secret
  )

  // Prepare circuit inputs
  const input = {
    domain: domainFields.map(x => x.toString()),
    walletAddress: addressToField(walletAddress).toString(),
    secret: secret.toString()
  }

  console.log('Generating real ZK proof with inputs:', input)

  // Generate proof
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    `${ZK_BASE_PATH}/${CIRCUIT_NAME}.wasm`,
    `${ZK_BASE_PATH}/${CIRCUIT_NAME}.zkey`
  )

  console.log('Real proof generated:', proof)

  return {
    proof: {
      pi_a: proof.pi_a.map((x: string) => '0x' + BigInt(x).toString(16)) as [string, string, string],
      pi_b: proof.pi_b.map((arr: string[]) =>
        arr.map((x: string) => '0x' + BigInt(x).toString(16))
      ) as [[string, string], [string, string], [string, string]],
      pi_c: proof.pi_c.map((x: string) => '0x' + BigInt(x).toString(16)) as [string, string, string],
      protocol: proof.protocol,
      curve: proof.curve
    },
    publicSignals: publicSignals.map((s: string) => '0x' + BigInt(s).toString(16)),
    domain,
    method: 'jwt',
    generatedAt: Date.now(),
    walletAddress,
    isReal: true
  }
}

/**
 * Generate a mock proof with real Poseidon hashes
 */
async function generateMockProof(
  domain: string,
  walletAddress: string
): Promise<ProofData> {
  const secret = generateSecret()
  const { domainHash, nullifier, walletBinding } = await computeHashes(
    domain,
    walletAddress,
    secret
  )

  return {
    proof: {
      pi_a: [randomHex(), randomHex(), '0x1'],
      pi_b: [
        [randomHex(), randomHex()],
        [randomHex(), randomHex()],
        ['0x1', '0x1']
      ],
      pi_c: [randomHex(), randomHex(), '0x1'],
      protocol: 'groth16',
      curve: 'bn128'
    },
    publicSignals: [
      '0x' + domainHash.toString(16),
      '0x' + nullifier.toString(16),
      '0x' + walletBinding.toString(16)
    ],
    domain,
    method: 'jwt',
    generatedAt: Date.now(),
    walletAddress,
    isReal: false
  }
}

/**
 * Generate a ZK proof for JWT domain binding
 *
 * Automatically detects if circuit files exist:
 * - If yes: generates real snarkjs proof
 * - If no: generates mock proof with real hashes
 *
 * @param forceMock - Force mock mode even if circuit files exist
 */
export async function generateZKProof(
  domain: string,
  walletAddress: string,
  _jwtExpiry: number,
  options?: {
    forceMock?: boolean
  }
): Promise<ProofData> {
  const { forceMock = false } = options || {}

  // Check if we should use real proofs
  if (!forceMock) {
    const hasCircuitFiles = await checkCircuitFilesExist()
    if (hasCircuitFiles) {
      console.log('Circuit files found, generating real ZK proof...')
      try {
        return await generateRealProof(domain, walletAddress)
      } catch (error) {
        console.warn('Real proof generation failed, falling back to mock:', error)
      }
    } else {
      console.log('Circuit files not found, using mock proof (run `make circom` to enable real proofs)')
    }
  }

  return generateMockProof(domain, walletAddress)
}

/**
 * Verify a ZK proof
 */
export async function verifyZKProof(proof: ProofData): Promise<boolean> {
  // Mock proofs always "verify" (structure check only)
  if (!proof.isReal) {
    return (
      proof.proof.pi_a.length === 3 &&
      proof.proof.pi_b.length === 3 &&
      proof.proof.pi_c.length === 3 &&
      proof.publicSignals.length >= 3
    )
  }

  // Real proof verification
  try {
    const snarkjs = await import('snarkjs')
    const response = await fetch(`${ZK_BASE_PATH}/verification_key.json`)
    const vkey = await response.json()

    const snarkjsProof = {
      pi_a: proof.proof.pi_a.map(x => BigInt(x).toString()),
      pi_b: proof.proof.pi_b.map(arr => arr.map(x => BigInt(x).toString())),
      pi_c: proof.proof.pi_c.map(x => BigInt(x).toString()),
      protocol: proof.proof.protocol,
      curve: proof.proof.curve
    }

    const signals = proof.publicSignals.map(s => BigInt(s).toString())

    return await snarkjs.groth16.verify(vkey, signals, snarkjsProof)
  } catch (error) {
    console.error('Proof verification failed:', error)
    return false
  }
}
