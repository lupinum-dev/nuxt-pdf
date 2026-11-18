import { Buffer } from 'node:buffer'
import { createCipheriv, createHash, randomBytes } from 'node:crypto'
import type PDFDocument from '@react-pdf/pdfkit'
import type { PdfPermissions, PdfProtection } from '../../primitives'

// AES-256 encryption of a PDF with the standard security handler, revision 6
// (ISO 32000-2:2020, 7.6.4; PDF 1.7 with Adobe extension level 8). The pinned
// pdfkit writes AES-256 only as revision 5, whose password check is one
// SHA-256 and which ISO 32000-2 deprecates, so this module installs its own
// handler on pdfkit's `_security` hook (CONTRACTS.md, "Encryption"). pdfkit
// never gets a password, so it never writes RC4, AES-128 or revision 5.

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

const aes128CbcNoPadding = (key: Buffer, iv: Buffer, data: Buffer): Buffer => {
  const cipher = createCipheriv('aes-128-cbc', key, iv).setAutoPadding(false)
  return Buffer.concat([cipher.update(data), cipher.final()])
}

/** Algorithm 2.B (ISO 32000-2, 7.6.4.3.4): the hash of a password. */
const hardenedHash = (password: Buffer, salt: Buffer, userKey: Buffer): Buffer => {
  let k = createHash('sha256').update(Buffer.concat([password, salt, userKey])).digest()
  for (let round = 0; ; round++) {
    const k1 = Buffer.concat([password, k, userKey])
    const e = aes128CbcNoPadding(k.subarray(0, 16), k.subarray(16, 32), Buffer.concat(Array.from({ length: 64 }, () => k1)))
    let sum = 0
    for (let index = 0; index < 16; index++) sum += e[index]!
    k = createHash(HASHES[sum % 3]!).update(e).digest()
    if (round >= 63 && e.at(-1)! <= round - 31) return k.subarray(0, 32)
  }
}

const aes256NoPadding = (mode: 'cbc' | 'ecb', key: Buffer, data: Buffer): Buffer => {
  const cipher = mode === 'cbc'
    ? createCipheriv('aes-256-cbc', key, Buffer.alloc(16))
    : createCipheriv('aes-256-ecb', key, null)
  cipher.setAutoPadding(false)
  return Buffer.concat([cipher.update(data), cipher.final()])
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
  const ue = aes256NoPadding('cbc', hardenedHash(userPassword, userKeySalt, Buffer.alloc(0)), fileKey)
  const o = Buffer.concat([hardenedHash(ownerPassword, ownerValidation, u), ownerValidation, ownerKeySalt])
  const oe = aes256NoPadding('cbc', hardenedHash(ownerPassword, ownerKeySalt, u), fileKey)
  const perms = Buffer.alloc(16)
  perms.writeInt32LE(flags, 0)
  perms.writeUInt32LE(0xFFFFFFFF, 4)
  // 'T': the metadata stream is encrypted too (EncryptMetadata, default true).
  perms.write('Tadb', 8, 'latin1')
  randomBytes(4).copy(perms, 12)
  return { o, u, oe, ue, perms: aes256NoPadding('ecb', fileKey, perms) }
}

/** Encrypt one string or stream: a fresh IV, then AES-256-CBC with PKCS#7 padding. */
const encryptObjectData = (fileKey: Buffer) => (data: Buffer): Buffer => {
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-cbc', fileKey, iv)
  return Buffer.concat([iv, cipher.update(data), cipher.final()])
}

/**
 * Encrypt the document `context` writes. Call it right after the document
 * is created, before any object is written. With only `openPassword`, the
 * owner password is 32 random bytes that are not kept; with only
 * `ownerPassword`, the open password is empty.
 */
export const protectDocument = (context: PDFDocument, protection: PdfProtection): void => {
  const fileKey = randomBytes(32)
  const userPassword = Buffer.from(protection.openPassword ?? '', 'utf8')
  const ownerPassword = protection.ownerPassword === undefined ? randomBytes(32) : Buffer.from(protection.ownerPassword, 'utf8')
  const flags = permissionFlags(protection.allow)
  const { o, u, oe, ue, perms } = encryptionValues(fileKey, userPassword, ownerPassword, flags)
  const encrypt = encryptObjectData(fileKey)

  context._root.data.Extensions = { ADBE: { BaseVersion: '1.7', ExtensionLevel: 8 } }
  context._security = {
    // Buffers are written as hex strings and never encrypted.
    dictionary: context.ref({
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
    }),
    // AES-256 uses the file key for every object (no per-object key).
    getEncryptFn: () => encrypt,
    end() {
      this.dictionary.end()
    },
  }
}
