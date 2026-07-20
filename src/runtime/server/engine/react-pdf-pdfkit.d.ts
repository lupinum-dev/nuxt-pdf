declare module '@react-pdf/pdfkit' {
  import type { Readable } from 'node:stream'

  export default class PDFDocument extends Readable {
    constructor(options?: Record<string, unknown>)
  }
}
