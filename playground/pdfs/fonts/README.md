# Playground fonts

Local `.ttf` inputs for the playground PDFs. These are static font instances
(one file per weight/style — no variable fonts, no faux bolding) so weights are
genuinely distinct in the rendered output. They are used only as local
playground inputs and are not part of the published package.

Registered in `playground/nuxt.config.ts` under `pdf.fonts`. Reference them from
styles via `fontFamily` plus a numeric `fontWeight` / `fontStyle`.

## Inter — workhorse sans (grotesque)

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

## Lora — book serif

Source: `@expo-google-fonts/lora@0.4.2` (npm), static Google Fonts `.ttf`
instances. License: SIL Open Font License 1.1 (OFL).
Copyright 2011 The Lora Project Authors (https://github.com/cyrealtype/Lora-Cyrillic).

| File                   | family | fontWeight | fontStyle |
| ---------------------- | ------ | ---------- | --------- |
| `Lora-400.ttf`         | Lora   | 400        | normal    |
| `Lora-400-italic.ttf`  | Lora   | 400        | italic    |
| `Lora-600.ttf`         | Lora   | 600        | normal    |
| `Lora-700.ttf`         | Lora   | 700        | normal    |

## Roboto — legacy fixture

`Roboto-Regular.ttf` is copied from the React PDF layout test fixture at commit
`d41a8207fb06a56e60fcb53ac0e18ce27e7d32d6`. Its embedded metadata identifies
Roboto Regular, Copyright 2011 Google Inc. (Apache License 2.0). Registered as
the `Fieldnote Sans` family for the invoice template and existing tests.
