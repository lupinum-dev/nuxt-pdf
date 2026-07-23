export interface Certificate {
  /** Hero line — the person the certificate honours. */
  recipient: string
  /** What was completed. */
  course: string
  /** Human-formatted award date. */
  date: string
  /** Name of the authorising signatory. */
  issuer: string
  /** Role printed under the signatory rule. */
  issuerTitle: string
  /** Small reference printed beneath the seal. */
  credentialId: string
  /** Program / awarding body eyebrow above the title. */
  program: string
}

export const sampleCertificate: Certificate = {
  recipient: 'Amelia Rose Hartwell',
  course: 'Advanced Typographic Systems',
  date: '21 July 2026',
  issuer: 'Dr. Elena Voss',
  issuerTitle: 'Program Director',
  credentialId: 'NPX-2026-4471',
  program: 'Fieldnote Institute of Design',
}

// Stress case: a long, multi-part recipient name plus a longer course title.
// The hero line must stay on one line (or wrap gracefully) without breaking the
// centered composition or colliding with the surrounding ornament.
export const longNameCertificate: Certificate = {
  recipient: 'Maximilian Alexander von Habsburg-Lothringen',
  course: 'Computational Foundations of Distributed Systems Engineering',
  date: '21 July 2026',
  issuer: 'Prof. Katharina Bergström',
  issuerTitle: 'Dean of Continuing Studies',
  credentialId: 'NPX-2026-4472',
  program: 'Fieldnote Institute of Design',
}
