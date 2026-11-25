---
'@lupinum/nuxt-pdf': minor
---

Add running headers and carried subtotals: `running` sets a value, and `PdfRunningText` prints it on each page

`running` on a `PdfText` sets a value, and `PdfRunningText` prints the value set by the node at the very top of the page, otherwise the last value set before the page. `:running="{ name, text }"` sets a value of its own, such as a short title. `PdfRunningText` takes `at="before"` (the value before the page) and `at="end"` (the last value set on the page), and `PdfTableRow` takes `:running`, so a table can show a carried subtotal; `fixed` nodes with `pages="not-last"` show it on every page but the last. A running token whose value is not known yet, and one in an `'auto'` table column, takes the room of the value of its name that needs the most room. A `PdfRunningText` directly in a view fails with the hint to put it inside a `<PdfText>`, as the other page tokens do.
