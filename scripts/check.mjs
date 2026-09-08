/**
 * Runs the self test.
 *
 * The suite is TypeScript with bare and extensionless imports, so it needs a
 * bundle step. We drive esbuild through its JS API rather than its CLI: the
 * CLI is reached through a node_modules/.bin shim, and esbuild's install
 * script swaps its bin entry from a JS shim to a raw native binary, which
 * leaves some package managers with a shim that hands an ELF file to node.
 * The API has no such ordering problem and behaves the same under npm, pnpm,
 * yarn and bun.
 */
import { build } from 'esbuild'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = await mkdtemp(join(tmpdir(), 'sup-check-'))
const outfile = join(dir, 'selftest.mjs')

try {
  await build({
    entryPoints: [join(root, 'src/selftest.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    outfile,
    logLevel: 'warning',
  })
  await import(pathToFileURL(outfile).href)
} finally {
  process.on('exit', () => { rm(dir, { recursive: true, force: true }) })
}
