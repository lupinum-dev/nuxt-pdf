---
'@lupinum/nuxt-pdf': minor
---

Change every color-valued style key and prop to take the same color forms, painted exactly as written

Border colors and the SVG `fill`, `stroke` and `stopColor` now take what backgrounds and text take: hex with alpha, `rgb()`, `hsl()`, `hwb()`, color names in any case and `transparent`. Before, a border or SVG color with alpha, `transparent`, `hwb()` or an upper-case name failed. A color's alpha now multiplies `opacity`, as in CSS: a background of `rgba(0, 0, 0, 0.5)` under `opacity: 0.5` paints at 25 %, where it took the lower of the two (50 %), and a text color with alpha is no longer replaced by the text's `opacity`. `rgba(255, 0, 0, 0.5)` writes an opacity of 0.5, not 128/255. `hsl()` converts fractional values as written (`hsl(0, 100%, 50.4%)` paints `#FF0202`, not `#FF0000`), and a channel half way between two whole values rounds up (`hsl(350, 60%, 75%)` paints `#E699A6`, not `#E599A6`). An `hwb()` color without a hue, and an `hsl()` color whose hue runs into its saturation, fail with `PDF_TREE_INVALID` instead of painting a wrong color. A form field color with alpha fails with `PDF_TREE_INVALID`, because a field draws its colors without alpha.

Migration: a background or text whose color has alpha and whose `opacity` is below 1 paints lighter; raise the alpha or the opacity to keep the old look. Give form fields opaque colors.
