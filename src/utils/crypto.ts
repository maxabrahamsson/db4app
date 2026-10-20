/**
 * End-to-end encryption utilities for SQL queries
 * Uses RSA-OAEP for encryption so the relay cannot decrypt SQL
 */

const KEY_STORAGE_KEY = 'db4app-encryption-keys'
const KEY_ALGORITHM = 'RSA-OAEP'
const KEY_HASH = 'SHA-256'
const KEY_MODULUS_LENGTH = 2048

export interface KeyPair {
  publicKey: CryptoKey
  privateKey: CryptoKey
}

export interface SerializedKeyPair {
  publicKey: string // Base64 encoded SPKI
  privateKey: string // Base64 encoded PKCS8
}

/**
 * Generate a new RSA key pair for encryption
 */
export async function generateKeyPair(): Promise<KeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: KEY_ALGORITHM,
      modulusLength: KEY_MODULUS_LENGTH,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: KEY_HASH,
    },
    true, // extractable
    ['encrypt', 'decrypt'],
  )

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
  }
}

/**
 * Serialize a key pair to JSON for storage
 */
export async function serializeKeyPair(keyPair: KeyPair): Promise<SerializedKeyPair> {
  const [publicKeyBuffer, privateKeyBuffer] = await Promise.all([
    crypto.subtle.exportKey('spki', keyPair.publicKey),
    crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
  ])

  return {
    publicKey: arrayBufferToBase64(publicKeyBuffer),
    privateKey: arrayBufferToBase64(privateKeyBuffer),
  }
}

/**
 * Deserialize a key pair from JSON
 */
export async function deserializeKeyPair(serialized: SerializedKeyPair): Promise<KeyPair> {
  const [publicKeyBuffer, privateKeyBuffer] = await Promise.all([
    base64ToArrayBuffer(serialized.publicKey),
    base64ToArrayBuffer(serialized.privateKey),
  ])

  const [publicKey, privateKey] = await Promise.all([
    crypto.subtle.importKey(
      'spki',
      publicKeyBuffer,
      {
        name: KEY_ALGORITHM,
        hash: KEY_HASH,
      },
      true,
      ['encrypt'],
    ),
    crypto.subtle.importKey(
      'pkcs8',
      privateKeyBuffer,
      {
        name: KEY_ALGORITHM,
        hash: KEY_HASH,
      },
      true,
      ['decrypt'],
    ),
  ])

  return { publicKey, privateKey }
}

/**
 * Encrypt data with a public key
 */
export async function encrypt(publicKey: CryptoKey, data: string): Promise<string> {
  const encoder = new TextEncoder()
  const dataBuffer = encoder.encode(data)
  const encrypted = await crypto.subtle.encrypt(
    {
      name: KEY_ALGORITHM,
    },
    publicKey,
    dataBuffer,
  )
  return arrayBufferToBase64(encrypted)
}

/**
 * Decrypt data with a private key
 */
export async function decrypt(privateKey: CryptoKey, encryptedData: string): Promise<string> {
  const encryptedBuffer = base64ToArrayBuffer(encryptedData)
  const decrypted = await crypto.subtle.decrypt(
    {
      name: KEY_ALGORITHM,
    },
    privateKey,
    encryptedBuffer,
  )
  const decoder = new TextDecoder()
  return decoder.decode(decrypted)
}

/**
 * Get the public key as a base64 string for sharing
 */
export async function getPublicKeyString(publicKey: CryptoKey): Promise<string> {
  const exported = await crypto.subtle.exportKey('spki', publicKey)
  return arrayBufferToBase64(exported)
}

/**
 * Import a public key from a base64 string
 */
export async function importPublicKey(publicKeyString: string): Promise<CryptoKey> {
  const buffer = base64ToArrayBuffer(publicKeyString)
  return crypto.subtle.importKey(
    'spki',
    buffer,
    {
      name: KEY_ALGORITHM,
      hash: KEY_HASH,
    },
    true,
    ['encrypt'],
  )
}

/**
 * Store key pair in IndexedDB
 */
export async function storeKeyPair(serialized: SerializedKeyPair): Promise<void> {
  if (typeof window === 'undefined') return
  localStorage.setItem(KEY_STORAGE_KEY, JSON.stringify(serialized))
}

/**
 * Load key pair from IndexedDB
 */
export async function loadKeyPair(): Promise<SerializedKeyPair | null> {
  if (typeof window === 'undefined') return null
  const stored = localStorage.getItem(KEY_STORAGE_KEY)
  if (!stored) return null
  try {
    return JSON.parse(stored) as SerializedKeyPair
  } catch {
    return null
  }
}

/**
 * Clear stored key pair
 */
export function clearKeyPair(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(KEY_STORAGE_KEY)
}

/**
 * Validates SQL against allowed tables (same logic as relay)
 */
export function validateSQL(sql: string, allowedTables: string[]): { valid: boolean; error?: string } {
  if (!allowedTables || allowedTables.length === 0) {
    return { valid: true }
  }

  const sqlUpper = sql.toUpperCase().trim()
  const dangerousOps = ['DROP', 'TRUNCATE', 'ALTER', 'DELETE']
  const hasDangerousOp = dangerousOps.some((op) => sqlUpper.startsWith(op))

  const tablePattern = /FROM\s+([a-z_][a-z0-9_]*\.?[a-z_][a-z0-9_]*)/gi
  const matches = [...sql.matchAll(tablePattern)]
  const referencedTables = matches.map((m) => m[1].toLowerCase())

  for (const table of referencedTables) {
    const normalized = table.includes('.') ? table : `public.${table}`
    if (!allowedTables.some((allowed) => allowed.toLowerCase() === normalized)) {
      return {
        valid: false,
        error: `Access denied: Table "${table}" is not in the allowed list. Allowed tables: ${allowedTables.join(', ')}`,
      }
    }
  }

  if (hasDangerousOp && referencedTables.length > 0) {
    for (const table of referencedTables) {
      const normalized = table.includes('.') ? table : `public.${table}`
      if (!allowedTables.some((allowed) => allowed.toLowerCase() === normalized)) {
        return {
          valid: false,
          error: `Operation denied: Cannot perform ${sqlUpper.split(' ')[0]} on table "${table}". Only allowed tables can be modified.`,
        }
      }
    }
  }

  return { valid: true }
}

// Helper functions
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

