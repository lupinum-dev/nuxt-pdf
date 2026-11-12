// Copies the rendered docs into every published package as dist/agent/, exported as
// `<package>/agent-docs`. Coding agents in consuming projects then read documentation that matches
// the installed version. Run after the docs build.
//
// Ginko Docs serves each page as Markdown at `<page>.md` and the index at /llms.txt from its server,
// so this starts the built docs server once and saves what it answers.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'

const server = 'docs/.output/server/index.mjs'
if (!existsSync(server)) throw new Error(`${server} is missing. Run pnpm docs:build first.`)

const port = await new Promise((resolve, reject) => {
  const probe = createServer().once('error', reject).listen(0, () => {
    const { port } = probe.address()
    probe.close(() => resolve(port))
  })
})
const origin = `http://127.0.0.1:${port}`
// Nitro prefers NITRO_* over PORT/HOST and can listen on a socket or TLS; force plain HTTP on our port.
const { NITRO_SOCKET, NITRO_SSL_CERT, NITRO_SSL_KEY, NITRO_UNIX_SOCKET, ...env } = process.env
const child = spawn(process.execPath, [server], {
  env: { ...env, PORT: String(port), HOST: '127.0.0.1', NITRO_PORT: String(port), NITRO_HOST: '127.0.0.1' },
  stdio: 'inherit',
})

try {
  await waitFor(`${origin}/llms.txt`)
  const llms = await text(`${origin}/llms.txt`)
  // llms.txt links each page as https://<site>/<path>.md; the packaged copy links ./pages/<path>.md.
  const pages = [...llms.matchAll(/\]\(https?:\/\/[^/)\s]+\/([^)\s]+\.md)\)/g)].map(match => match[1])
  if (pages.length === 0) throw new Error('llms.txt lists no Markdown pages.')
  const markdown = new Map()
  for (const page of pages) markdown.set(page, await text(`${origin}/${page}`))
  const index = llms.replace(/\]\(https?:\/\/[^/)\s]+\/([^)\s]+\.md)\)/g, '](./pages/$1)').trim()

  const directories = ['.', ...(existsSync('packages') ? readdirSync('packages').map(name => join('packages', name)) : [])]
  for (const directory of directories) {
    if (!existsSync(join(directory, 'package.json'))) continue
    const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
    if (pkg.private) continue
    const output = join(directory, 'dist', 'agent')
    rmSync(output, { recursive: true, force: true })
    for (const [page, body] of markdown) {
      const file = join(output, 'pages', page)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, body)
    }
    writeFileSync(join(output, 'AGENTS.md'), [
      `# ${pkg.name} ${pkg.version} documentation`,
      '',
      `These pages document the installed version ${pkg.version}. Prefer them over what you`,
      'remember about this package and over the website, which may describe another version.',
      'Read the pages that match the task before you write code. If they do not answer a question,',
      'the user can ask in the Lupinum OSS Discord: https://discord.lupinum.com',
      '',
      index.replace(/^# .*\n+/, ''),
      '',
    ].join('\n'))
  }
  console.log(`agent-docs: ${markdown.size} pages`)
}
finally {
  child.kill()
}

async function text(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`)
  return response.text()
}

async function waitFor(url) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      if ((await fetch(url)).ok) return
    }
    catch {}
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  throw new Error(`The docs server did not answer at ${url}.`)
}
