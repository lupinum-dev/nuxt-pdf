# Playground fonts

Local `.ttf` and `.otf` inputs for the playground PDFs. These are static font instances
(one file per weight and style, with no variable fonts or simulated bolding) so weights are
genuinely distinct in the rendered output. They are used only as local
playground inputs and are not part of the published package.

Registered in `playground/nuxt.config.ts` under `pdf.fonts`. Reference them from
styles via `fontFamily` plus a numeric `fontWeight` / `fontStyle`.

The complete SIL Open Font License text for the OFL fonts in this directory is
included in `OFL.txt` (Inter, Lora), `OFL-Cormorant.txt` and `OFL-Literata.txt`.

## Inter workhorse sans

Source: `@expo-google-fonts/inter@0.4.2` (npm), which ships static Google Fonts
`.ttf` instances. License: SIL Open Font License 1.1 (OFL).
Copyright 2020 The Inter Project Authors (https://github.com/rsms/inter).

| File            | family | fontWeight | fontStyle |
| --------------- | ------ | ---------- | --------- |
| `Inter-400.ttf` | Inter  | 400        | normal    |
| `Inter-500.ttf` | Inter  | 500        | normal    |
| `Inter-600.ttf` | Inter  | 600        | normal    |
| `Inter-700.ttf` | Inter  | 700        | normal    |
| `Inter-800.ttf` | Inter  | 800        | normal    |

## Lora book serif

Source: `@expo-google-fonts/lora@0.4.2` (npm), static Google Fonts `.ttf`
instances. License: SIL Open Font License 1.1 (OFL).
Copyright 2011 The Lora Project Authors (https://github.com/cyrealtype/Lora-Cyrillic).

| File                   | family | fontWeight | fontStyle |
| ---------------------- | ------ | ---------- | --------- |
| `Lora-400.ttf`         | Lora   | 400        | normal    |
| `Lora-400-italic.ttf`  | Lora   | 400        | italic    |
| `Lora-600.ttf`         | Lora   | 600        | normal    |
| `Lora-700.ttf`         | Lora   | 700        | normal    |

## Cormorant display serif

Used for the display lines of the menu, the certificate, the e-book and the article.
Source: the static `.ttf` instances of Cormorant v4.000. License: SIL Open Font
License 1.1 (OFL), see `OFL-Cormorant.txt`.
Copyright 2015 The Cormorant Project Authors (https://github.com/CatharsisFonts/Cormorant).

| File                       | family    | fontWeight | fontStyle |
| -------------------------- | --------- | ---------- | --------- |
| `Cormorant-500.ttf`        | Cormorant | 500        | normal    |
| `Cormorant-500-italic.ttf` | Cormorant | 500        | italic    |
| `Cormorant-600.ttf`        | Cormorant | 600        | normal    |

## Literata reading serif

Used for the reading text of the e-book, the article, the menu, the certificate and the research paper.
Source: the static `.otf` instances of Literata v3.021 (CFF outlines). License:
SIL Open Font License 1.1 (OFL), see `OFL-Literata.txt`.
Copyright 2017 The Literata Project Authors (https://github.com/googlefonts/literata).
`Literata-600.otf` is the SemiBold instance (weight class 650), registered as 600.

| File                      | family   | fontWeight | fontStyle |
| ------------------------- | -------- | ---------- | --------- |
| `Literata-400.otf`        | Literata | 400        | normal    |
| `Literata-400-italic.otf` | Literata | 400        | italic    |
| `Literata-600.otf`        | Literata | 600        | normal    |

## Roboto legacy fixture

`Roboto-Regular.ttf` is copied from the React PDF layout test fixture at commit
`d41a8207fb06a56e60fcb53ac0e18ce27e7d32d6`. Its embedded metadata identifies
Roboto Regular, Copyright 2011 Google Inc. (Apache License 2.0). Registered as
the `Fieldnote Sans` family for the font configuration tests.
