import { Buffer } from 'node:buffer'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import type { PdfPermissions, PdfProtection } from '../../primitives'

// AES-256 encryption of a PDF with the standard security handler, revision 6
// (ISO 32000-2:2020, 7.6.4; PDF 1.7 with Adobe extension level 8): the
// encryption dictionary and the function the writer encrypts every string
// and stream with (`pdf/file.ts`). No other cipher or revision is written;
// revision 5, a single SHA-256 password check, is deprecated by ISO 32000-2.

/** Permission bits (ISO 32000-2, Table 22), numbered from 1. */
const bit = (position: number): number => 2 ** (position - 1)

// Bits 1-2 must be 0; bits 7-8 and 13-32 must be 1 for revision 3 and later.
const RESERVED_BITS = 0xFFFFF0C0

/**
 * The `/P` value for these permissions: every permission is granted unless
 * the author turned it off. A signed 32-bit integer, as the PDF stores it.
 */
export const permissionFlags = (allow: PdfPermissions = {}): number => {
  const printing = allow.printing ?? 'high'
  let flags = RESERVED_BITS
  if (printing !== 'none') flags |= bit(3)
  if (allow.changing !== false) flags |= bit(4)
  if (allow.copying !== false) flags |= bit(5)
  if (allow.annotating !== false) flags |= bit(6)
  if (allow.fillingForms !== false) flags |= bit(9)
  if (allow.extractingForAccessibility !== false) flags |= bit(10)
  if (allow.assembling !== false) flags |= bit(11)
  if (printing === 'high') flags |= bit(12)
  return flags | 0
}

const HASHES = ['sha256', 'sha384', 'sha512'] as const

/** AES without padding: `data` is a whole number of 16-byte blocks. */
const aesNoPadding = (algorithm: 'aes-128-cbc' | 'aes-256-cbc' | 'aes-256-ecb', key: Buffer, iv: Buffer | null, data: Buffer): Buffer => {
  const cipher = createCipheriv(algorithm, key, iv).setAutoPadding(false)
  return Buffer.concat([cipher.update(data), cipher.final()])
}

/** Algorithm 2.B (ISO 32000-2, 7.6.4.3.4): the hash of a password. */
const hardenedHash = (password: Buffer, salt: Buffer, userKey: Buffer): Buffer => {
  let k = createHash('sha256').update(Buffer.concat([password, salt, userKey])).digest()
  for (let round = 0; ; round++) {
    const k1 = Buffer.concat([password, k, userKey])
    const e = aesNoPadding('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32), Buffer.concat(Array.from({ length: 64 }, () => k1)))
    let sum = 0
    for (let index = 0; index < 16; index++) sum += e[index]!
    k = createHash(HASHES[sum % 3]!).update(e).digest()
    if (round >= 63 && e.at(-1)! <= round - 31) return k.subarray(0, 32)
  }
}

/** The values of the encryption dictionary (ISO 32000-2, Algorithms 8, 9 and 10). */
export const encryptionValues = (
  fileKey: Buffer,
  userPassword: Buffer,
  ownerPassword: Buffer,
  flags: number,
) => {
  const [userValidation, userKeySalt, ownerValidation, ownerKeySalt] = [8, 8, 8, 8].map(size => randomBytes(size)) as [Buffer, Buffer, Buffer, Buffer]
  const u = Buffer.concat([hardenedHash(userPassword, userValidation, Buffer.alloc(0)), userValidation, userKeySalt])
  const ue = aesNoPadding('aes-256-cbc', hardenedHash(userPassword, userKeySalt, Buffer.alloc(0)), Buffer.alloc(16), fileKey)
  const o = Buffer.concat([hardenedHash(ownerPassword, ownerValidation, u), ownerValidation, ownerKeySalt])
  const oe = aesNoPadding('aes-256-cbc', hardenedHash(ownerPassword, ownerKeySalt, u), Buffer.alloc(16), fileKey)
  const perms = Buffer.alloc(16)
  perms.writeInt32LE(flags, 0)
  perms.writeUInt32LE(0xFFFFFFFF, 4)
  // 'T': the metadata stream is encrypted too (EncryptMetadata, default true).
  perms.write('Tadb', 8, 'latin1')
  randomBytes(4).copy(perms, 12)
  return { o, u, oe, ue, perms: aesNoPadding('aes-256-ecb', fileKey, null, perms) }
}

/** Encrypt one string or stream: a fresh IV, then AES-256-CBC with PKCS#7 padding. */
const encryptObjectData = (fileKey: Buffer) => (data: Uint8Array): Buffer => {
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-cbc', fileKey, iv)
  return Buffer.concat([iv, cipher.update(data), cipher.final()])
}

/** The catalog's `Extensions` of a protected document. */
export const ENCRYPTION_EXTENSIONS = { ADBE: { BaseVersion: '1.7', ExtensionLevel: 8 } } as const

/**
 * The encryption of one document: the entries of its encryption dictionary
 * (byte strings as buffers) and the function that encrypts each string and
 * stream. With only `openPassword`, the owner password is 32 random bytes
 * that are not kept; with only `ownerPassword`, the open password is empty.
 */
export const createEncryption = (protection: PdfProtection) => {
  const fileKey = randomBytes(32)
  const userPassword = Buffer.from(protection.openPassword ?? '', 'utf8')
  const ownerPassword = protection.ownerPassword === undefined ? randomBytes(32) : Buffer.from(protection.ownerPassword, 'utf8')
  const flags = permissionFlags(protection.allow)
  const { o, u, oe, ue, perms } = encryptionValues(fileKey, userPassword, ownerPassword, flags)
  return {
    dictionary: {
      Filter: 'Standard',
      V: 5,
      R: 6,
      Length: 256,
      CF: { StdCF: { AuthEvent: 'DocOpen', CFM: 'AESV3', Length: 32 } },
      StmF: 'StdCF',
      StrF: 'StdCF',
      O: o,
      U: u,
      OE: oe,
      UE: ue,
      P: flags,
      Perms: perms,
    },
    encrypt: encryptObjectData(fileKey),
  }
}
