import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'
import { PdfBytes, PdfRef, serialize, type Encrypt, type PdfValue } from './objects'

// The file of our writer: objects numbered in the order they are reserved,
// written in number order, a classic cross-reference table and a trailer
// whose ID is a hash of the content (D37). Built in memory; nothing depends on the clock or on
// asynchronous work, so one document gives one file.

type Dictionary = { readonly [key: string]: PdfValue | undefined }

export interface PdfFile {
  /** A number for an object written later (with `set` or `stream`). */
  reserve(): PdfRef
  /** Writes a non-stream object; reserves its number when none is given. */
  set(value: PdfValue, ref?: PdfRef): PdfRef
  /** Writes a stream; Flate-compressed when the file compresses, `dictionary` names no filter and `compress` is not false. */
  stream(dictionary: Dictionary, data: Uint8Array | string, ref?: PdfRef, options?: { compress?: boolean }): PdfRef
  /** The finished file; an encrypted file names its encryption dictionary, which is written as it is. */
  finish(root: PdfRef, info: PdfRef, encryption?: PdfValue): Uint8Array<ArrayBuffer>
}

const encoder = new TextEncoder()
/** Content streams are ASCII; a string is written byte per character. */
const bytesOf = (data: Uint8Array | string): Uint8Array =>
  typeof data === 'string' ? Buffer.from(data, 'latin1') : data

/**
 * With `encrypt`, every string and every stream is encrypted after
 * compression, except the encryption dictionary (ISO 32000-2, 7.6.2); the
 * trailer is no object, so its ID stays plain.
 */
export const createPdfFile = ({ version, compress, encrypt }: { version: string, compress: boolean, encrypt?: Encrypt }): PdfFile => {
  const bodies: (Uint8Array | undefined)[] = []

  const reserve = (): PdfRef => {
    bodies.push(undefined)
    return new PdfRef(bodies.length)
  }
  const store = (ref: PdfRef, parts: readonly Uint8Array[]): PdfRef => {
    if (bodies[ref.id - 1] !== undefined) throw new Error(`Nuxt PDF wrote object ${ref.id} twice.`)
    bodies[ref.id - 1] = Buffer.concat([encoder.encode(`${ref.id} 0 obj\n`), ...parts, encoder.encode('\nendobj\n')])
    return ref
  }

  return {
    reserve,
    set: (value, ref = reserve()) => store(ref, [encoder.encode(serialize(value, encrypt))]),
    stream: (dictionary, data, ref = reserve(), options = {}) => {
      const raw = bytesOf(data)
      const deflate = compress && options.compress !== false && dictionary.Filter === undefined
      const compressed = deflate ? deflateSync(raw) : raw
      const body = encrypt === undefined ? compressed : encrypt(compressed)
      const head = serialize({ ...dictionary, ...(deflate ? { Filter: 'FlateDecode' } : {}), Length: body.length }, encrypt)
      return store(ref, [encoder.encode(`${head}\nstream\n`), body, encoder.encode('\nendstream')])
    },
    finish: (root, info, encryption) => {
      const encryptRef = encryption === undefined ? undefined : store(reserve(), [encoder.encode(serialize(encryption))])
      const missing = bodies.findIndex(body => body === undefined)
      if (missing !== -1) throw new Error(`Nuxt PDF reserved object ${missing + 1} and never wrote it.`)
      // `%` and four bytes above 127: the file holds binary data.
      const header = Buffer.concat([encoder.encode(`%PDF-${version}\n%`), Uint8Array.of(0xE2, 0xE3, 0xCF, 0xD3), encoder.encode('\n')])
      const offsets: number[] = []
      let offset = header.length
      for (const body of bodies as Uint8Array[]) {
        offsets.push(offset)
        offset += body.length
      }
      const hash = createHash('md5')
      for (const body of bodies as Uint8Array[]) hash.update(body)
      const id = new PdfBytes(hash.digest())
      const xref = [
        'xref',
        `0 ${bodies.length + 1}`,
        '0000000000 65535 f ',
        ...offsets.map(value => `${String(value).padStart(10, '0')} 00000 n `),
      ].join('\n')
      const trailer = serialize({ Size: bodies.length + 1, Root: root, Info: info, Encrypt: encryptRef, ID: [id, id] })
      return Buffer.concat([header, ...(bodies as Uint8Array[]), encoder.encode(`${xref}\ntrailer\n${trailer}\nstartxref\n${offset}\n%%EOF\n`)])
    },
  }
}
