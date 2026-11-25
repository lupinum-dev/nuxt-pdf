# Third-party notices

## React PDF

Nuxt PDF ships a TypeScript port of `@react-pdf/layout` 4.6.1
(`dist/runtime/server/engine/layout/`), a TypeScript port of the
`@react-pdf/render` 4.5.1 painter (`dist/runtime/server/engine/paint/`), a
TypeScript port of `@react-pdf/textkit` 6.3.0
(`dist/runtime/server/engine/text/`), and carries paired test fixtures
derived from the React PDF repository at commit
`d41a8207fb06a56e60fcb53ac0e18ce27e7d32d6`.

React PDF is distributed under the following MIT license:

```text
MIT License

Copyright (c) 2017-present Diego Muracciole <diegomuracciole@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The exact engine packages and versions are recorded in
`src/runtime/server/engine/CONTRACTS.md`; the package build carries that record
at `dist/runtime/server/engine/CONTRACTS.md`. Their own package distributions
remain subject to their included licenses.

## PDFKit

Nuxt PDF writes its PDF files with its own writer. Its painter carries code
ported from PDFKit as `@react-pdf/pdfkit` 5.1.1 bundles it: the SVG path
tokenizer, the drawing of path commands and the conversion of arcs to curves
(`dist/runtime/server/engine/paint/svg-path.*`), and the ellipse and the
rotation and scale around an origin (`dist/runtime/server/engine/paint/box.*`).

PDFKit is distributed under the following MIT license:

```text
MIT LICENSE
Copyright (c) 2014 Devon Govett

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

## SVG path helpers

`dist/runtime/server/engine/paint/svg-path.*` also carries ports of the two
helpers `@react-pdf/render` 4.5.1 uses for the box of a gradient on a path:
`normalize-svg-path` 1.1.0 and `svg-arc-to-cubic-bezier` 3.2.0.

`normalize-svg-path` is distributed under the following MIT license:

```text
The MIT License

Copyright © 2008-2013 Dmitry Baranovskiy (http://raphaeljs.com)
Copyright © 2008-2013 Sencha Labs (http://sencha.com)
Copyright © 2013 Jake Rosoman <jkroso@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
'Software'), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
```

`svg-arc-to-cubic-bezier` is distributed under the following ISC license:

```text
Copyright (c) 2017, Colin Meinke

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
```

## Adobe Core 14 font metrics

`src/runtime/server/engine/standard-font-metrics.ts` (shipped as
`dist/runtime/server/engine/standard-font-metrics.*`) holds the advance widths
and kerning pairs of the 12 standard PDF fonts Nuxt PDF lays out (Courier,
Helvetica and Times, each in four styles), derived from the Adobe Core 14 AFM
files as `@react-pdf/pdfkit` 5.1.1 bundles them: only the widths per WinAnsi
code and the kerning per pair of codes are kept, in a different form, and the
generated file says so. The AFM files carry the notice "Copyright (c) 1985,
1987, 1989, 1990, 1997 Adobe Systems Incorporated. All Rights Reserved." (the
years differ per font) and are distributed under these terms:

```text
This file and the 14 PostScript(R) AFM files it accompanies may be used,
copied, and distributed for any purpose and without charge, with or without
modification, provided that all copyright notices are retained; that the AFM
files are not distributed without this file; that all modifications to this
file or any of the AFM files are prominently noted in the modified file(s);
and that this paragraph is not removed or modified in any way.
```

## Fixture provenance

The following files originate from the React PDF test suite at the commit
above and are retained only as local conformance, integration, or playground
fixtures:

| Nuxt PDF fixture | React PDF source |
|---|---|
| `test/fixtures/assets/Roboto-Regular.ttf` | `packages/layout/tests/assets/font.ttf` |
| `test/fixtures/assets/sample.png` | `packages/layout/tests/assets/test.png` |

The copies under `test/fixtures/basic/pdfs/` use the same fixture bytes. The
playground copies the font as `pdfs/fonts/Roboto-Regular.ttf` and the image as
`pdfs/assets/alpine.png`.

The font identifies itself as Roboto Regular, copyright 2011 Google Inc., by
Christian Robertson, and as licensed under the Apache License 2.0:
<https://www.apache.org/licenses/LICENSE-2.0>.

These fixture binaries are not included in the published Nuxt PDF package.

## Source Code Pro test dependency

The development-only `source-code-pro` npm package supplies OTF and variable
font fixtures for executable compatibility tests. Source Code Pro is Copyright
2010–2023 Adobe and distributed under the SIL Open Font License 1.1. It is not
included in the published Nuxt PDF package; its license is included in the npm
dependency at `source-code-pro/LICENSE.md`.

## Noto international typography subsets

The test-only international typography fixture contains small FontTools subsets
of Noto Sans SC Variable, Noto Sans Arabic Variable, and Noto Emoji Variable.
They retain only the characters used by the executable calibration document,
are distributed under the SIL Open Font License 1.1 included beside the files,
and are not included in the published Nuxt PDF package.
