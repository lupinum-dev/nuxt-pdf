// Data model for the "letter" showcase: a one-page business letter of the
// fictional landscape architects Kestrel & Moss to a community garden. Every
// name, address and number is invented.

export interface LetterParty {
  name: string
  /** A person to address inside the organization. */
  attention?: string
  street: string
  city: string
  country?: string
}

export interface Letter {
  sender: LetterParty & { phone: string, email: string, web: string, iban: string, vatId: string }
  recipient: LetterParty
  /** Reference lines of the information block, in order. */
  references: Array<{ label: string, value: string }>
  date: string
  subject: string
  salutation: string
  paragraphs: string[]
  closing: string
  signer: { name: string, role: string }
}

export const sampleLetter: Letter = {
  sender: {
    name: 'Kestrel & Moss',
    street: 'Kleestraße 7',
    city: '12345 Musterstadt',
    phone: '+49 123 456 789-0',
    email: 'studio@kestrel-moss.example',
    web: 'kestrel-moss.example',
    iban: 'DE00 1234 5678 9012 3456 78',
    vatId: 'DE000000000',
  },
  recipient: {
    name: 'Riverside Community Garden e. V.',
    attention: 'Ada Quillfeather',
    street: 'Uferweg 21',
    city: '12345 Musterstadt',
  },
  references: [
    { label: 'Your reference', value: 'AQ/0412' },
    { label: 'Our reference', value: 'KM-2026-118' },
    { label: 'Contact', value: 'Lio Brandt' },
    { label: 'Phone', value: '+49 123 456 789-12' },
    { label: 'Email', value: 'lio.brandt@kestrel-moss.example' },
  ],
  date: '14 October 2026',
  subject: 'Planting plan for the north beds',
  salutation: 'Dear Ms Quillfeather,',
  paragraphs: [
    'Thank you for showing us the north beds last Tuesday. We have measured the site and drawn a first planting plan, which you find enclosed.',
    'The plan keeps the three old apple trees and the willow by the fence. Between them we suggest a strip of native meadow flowers that needs mowing only twice a year, and four raised beds along the path, so that members who cannot kneel can garden too.',
    'We can plant in two steps: the meadow strip this November, the raised beds in March, when the ground is dry enough to work. The enclosed estimate lists both steps separately, so the board can decide on each one.',
    'If the plan suits you, we would like to present it at your members’ evening on 5 November. Please call me if you have questions before then.',
  ],
  closing: 'Kind regards,',
  signer: { name: 'Lio Brandt', role: 'Landscape architect' },
}
