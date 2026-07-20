# Third-party notices

## React PDF

Nuxt PDF uses the published lower-level React PDF engine packages and carries
paired test fixtures derived from the React PDF repository at commit
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
