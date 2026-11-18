// Validates the PDF/A-3b fixtures of test/pdfa.test.ts with veraPDF. The image
// is pinned by digest in test/fixtures/verapdf-image.json. Not part of
// `pnpm verify`; CI runs it in its own job. Docker must run: without it this
// fails, it never skips.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const { image } = JSON.parse(readFileSync(new URL('../test/fixtures/verapdf-image.json', import.meta.url), 'utf8'))

const docker = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' })
if (docker.error || docker.status !== 0) {
  console.error([
    'pnpm test:pdfa needs a running Docker daemon: it runs veraPDF from a Docker image.',
    'Start Docker (on macOS: open -ga Docker) and run it again.',
    (docker.error?.message ?? docker.stderr ?? '').trim(),
  ].filter(Boolean).join('\n'))
  process.exit(1)
}

// Pull the image before vitest starts. A pull that runs inside the first tests
// makes them hit their timeout on a machine without the image (a fresh CI
// runner).
const present = spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', image], { encoding: 'utf8' })
if (present.status !== 0) {
  console.log(`Pulling ${image} …`)
  const pull = spawnSync('docker', ['pull', image], { stdio: 'inherit' })
  if (pull.error || pull.status !== 0) {
    console.error([
      `pnpm test:pdfa could not pull the veraPDF image ${image}.`,
      'Check the network and that Docker can reach Docker Hub, then run it again.',
      pull.error?.message ?? '',
    ].filter(Boolean).join('\n'))
    process.exit(1)
  }
}

const vitest = spawnSync('pnpm', ['exec', 'vitest', 'run', 'test/pdfa.test.ts'], {
  stdio: 'inherit',
  env: { ...process.env, NUXT_PDF_VERAPDF: '1' },
})
process.exit(vitest.status ?? 1)
