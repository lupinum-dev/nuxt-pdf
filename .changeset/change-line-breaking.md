---
'@lupinum/nuxt-pdf': minor
---

Change line breaking to keep natural spacing, end ragged lines more evenly and follow the Unicode line breaking rules

Each line now holds only the words that fit at their natural width, a hyphenated line ends inside its box, and justified text only stretches its spaces; before, a line could hold more text than fit and its letters and spaces were pressed together. Left, right and centered text chooses its breaks as TeX's ragged-right setting does: a line may end short, and a word splits with a hyphen only when that avoids a much shorter line. Lines break by the Unicode rules (UAX #14): also between Chinese or Japanese characters, after a hyphen or a slash (only when it gives more even lines) and at a zero-width space; never at a no-break space or before closing punctuation such as `!`; a line or paragraph separator (U+2028, U+2029) ends the line. A word wider than its box keeps its width and continues past the box. The package adds the dependency `linebreak` 1.1.0.

Text layout fixes:

- A word whose parts have different styles, links or fonts with no space between them (`un<b>believ</b>able`) hyphenates as one word. A line no longer breaks between two runs with no space between, and a word before two or more spaces, before a line break or next to an inline image gets no hyphen at a line end.
- Long paragraphs lay out in time in proportion to their length, not to its square, with the same pages.
- The spaces at both ends of a paragraph, which a template gives when the content is on its own line, take no room in line breaking: right-aligned and centered text no longer sits a space off, an underline or strike-through no longer starts a space too far right, and a text without a width that wraps takes the full width it is offered, as in CSS.
- A text that a row shrinks is laid out again in the narrower width, and a text whose `minWidth` is wider than its lines is laid out in that width, so its lines no longer run past its box or keep the alignment of another width.
- Arabic letters that a font draws as more than one glyph, such as the dots of ب, ي and ة, are drawn where the font puts them, and a ligature such as "ffi" in a line with right-to-left text is no longer left out. A wrapped line that starts with such a letter no longer fails with an untyped `TypeError`. Copy and search in viewers built on pdf.js, such as Firefox, can give control characters and a changed word order for such fonts; Poppler-based tools read the text right.
- The underline of a nested text keeps the position and thickness of the text that sets it, so it stays one line under text of another size.

Migration: line breaks can move, so a paragraph can get one more line and a document one more page. Check the line and page breaks of documents with long paragraphs, narrow columns or narrow table cells, and of words after a hyphen such as `e-mail`. Put a word joiner (`&#8288;`) after a hyphen that must not break.
