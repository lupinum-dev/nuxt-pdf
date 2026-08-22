# Writing documentation

Nuxt PDF uses Lupinum Controlled English. This profile is based on
ASD-STE100 Issue 9. It does not claim formal ASD-STE100 compliance.

## Write for the user

- Start with the result or action.
- Use short, active sentences.
- Put one instruction in each sentence.
- Use the imperative form for procedures.
- Use one term for one concept.
- Define a technical term before you use it.
- Put a warning before the affected action.
- Use sentence-case headings.
- Use American English spelling.
- State behavior. Do not claim virtues such as honesty, rigor, trustworthiness,
  or transparency.
- Put the consequence next to the instruction.
- Use task-based headings in tutorials and guides.
- Use noun headings in reference and explanation pages.
- Give one recommended path before alternatives.
- Tell the user what to inspect or change after every documented error.
- Keep sentences short without making the prose robotic.

Do not use filler such as `simply`, `just`, `obviously`, `easy`, `seamless`, or
`powerful`.

Use `deliberate` or `intentional` only when a user could reasonably expect
React PDF or browser behavior instead. Do not use internal test terms such as
`sidecar` or `canary` in public pages. Use `artifact` only for a retained build
or test output, not as a synonym for a package, file, or server output.

## Use the approved terms

Use these terms with the specified meaning:

- **Application**: the user's Nuxt application.
- **Repository**: this Git repository.
- **Package**: the published `@lupinum/nuxt-pdf` package.
- **Module**: the Nuxt module that the package installs.
- **Template**: a Vue SFC under `pdfs/` that defines one PDF document.
- **Primitive**: a Nuxt PDF component such as `PdfPage` or `PdfText`.
- **Render**: one operation that converts a template and props to PDF bytes.
- **Preview**: the development-only browser view under `/_pdf`.
- **Release candidate**: the exact retained tarball that passed release checks.
- **Stage**: an npm package version that waits for human approval.

Do not use `artifact`, `build`, `release`, and `package` as interchangeable
terms.

## Structure public READMEs

Center the 128 px product icon, product name, one-sentence value proposition,
and npm, CI, and MIT badges. State the release status when the package is not
stable.

Then explain why and when to use the product, requirements, installation, the
smallest useful example, product concepts, documentation, contribution,
support, security, and license. Explain user outcomes before internal
architecture. Keep fixture, font, baseline, and proof READMEs technical and
unbranded.

## Structure each page

- Put `title` and `description` in frontmatter.
- Do not add a body-level `#` heading.
- Organize content by user intent: get started, concepts, guides, reference,
  operations, or migration.
- Label every code fence with its language and file path when applicable.
- Show one concept in each example.
- Use a specific final section. Do not add generic `Summary`, `Conclusion`,
  `Related`, or `Next steps` sections.

Use these page types:

- A **tutorial** leads a newcomer through one complete successful result.
- A **guide** helps an existing user complete one task.
- A **reference** page lists exact types, defaults, accepted values, return
  values, and failure behavior.
- An **explanation** page describes the runtime model, limits, or design
  decisions without hiding a procedure inside it.

Do not put long architecture explanations in the first-render tutorial. Do not
put complete task procedures in a neutral API table. Link between page types
when the user needs both.

Match examples to the repository's TypeScript and Vue formatting. A complete
example must use public APIs and be safe to copy. Partial examples can omit
surrounding code only when the omission is clear from the page.

## Keep public and internal content separate

Public documentation explains supported user behavior. It must not contain
maintainer evidence, internal fixture names, release approval steps, or local
repository paths.

Keep maintainer procedures in `MAINTAINING.md`. Keep durable engine contracts
in `src/runtime/server/engine/CONTRACTS.md`.

## Exclusions

Do not rewrite:

- License or third-party legal text.
- Code and API identifiers.
- Command output.
- Quotations.
- Changelog identifiers.
- Generated API reports.
