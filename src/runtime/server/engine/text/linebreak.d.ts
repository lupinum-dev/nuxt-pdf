declare module 'linebreak' {
  /** A place where a line may start (UAX #14): a UTF-16 index, and whether a line must start there. */
  export interface Break {
    position: number
    required: boolean
  }
  /** linebreak 1.1.0 ships no types; these are the calls the text layout makes. */
  export default class LineBreaker {
    constructor(string: string)
    /** The next break, in string order; the end of the string is the last one. */
    nextBreak(): Break | null
  }
}
