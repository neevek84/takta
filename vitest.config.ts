import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// NOTE: `environmentMatchGlobs` (per-glob test environment) does not exist in
// the installed Vitest 4.x — it was removed in favor of `test.projects`.
// That replacement was tried here but currently cannot be used: this
// sandbox runs Node 22.11.0, and every published `jsdom` release (27–30)
// pulls in `@exodus/bytes`, a dependency that ships ESM-only with no CJS
// build. Vitest's default `forks` pool (and `threads`/`vmThreads`) load
// environments via `require()`, which fails on ESM-only packages before
// Node's native `require(esm)` support (stable from Node 22.12.0). Any
// project referencing `environment: 'jsdom'` is initialized eagerly by
// Vitest even when zero files match it, so merely declaring it breaks
// `npm test` here — verified by running the suite, not guessed.
//
// Until Node is upgraded to >=22.12 (or >=24) in this environment, or a
// jsdom release restores a CJS-safe dependency chain, component tests
// should add `// @vitest-environment jsdom` as the first line of the test
// file (Vitest's built-in per-file override) instead of relying on config
// here.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    // Les fichiers de test partagent une seule base SQLite : les exécuter en
    // parallèle produit des échecs non déterministes. La suite tourne en
    // moins d'une seconde, la sérialisation ne coûte rien.
    fileParallelism: false,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
