// Data model for the "registration" showcase: a one-page A5 form for a
// workshop of the fictional Fieldnote Studio. The participant fills it in a
// PDF reader; the template only sets the fields and their starting values.

export interface Registration {
  workshop: string
  date: string
  venue: string
  /** The sessions a participant can choose, in order. */
  sessions: readonly string[]
  /** A value the form starts with, such as a known participant's name. */
  participant?: string
}

export const sampleRegistration: Registration = {
  workshop: 'Field recording for beginners',
  date: 'Saturday, 14 March 2026',
  venue: 'Fieldnote Studio, Wiesengasse 8',
  sessions: ['Morning, 9:00–12:00', 'Afternoon, 14:00–17:00'],
}

export const returningParticipant: Registration = {
  ...sampleRegistration,
  participant: 'Ada Brightwater',
}
