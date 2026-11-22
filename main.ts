// Crescent Bay (gta6-01-v7) — entrypoint. Node 22, standard library only.
//
// The playable game is the plain static files under game/ (index.html plus its
// ES modules, no library, no network request). This program hands the entry in:
// it copies game/ and screenshots/ from beside this file into the output
// directory and writes /output/dossier.json with make.fun's vendored library
// (vendor/makefun-game.ts, the scorer's own copy — never edited). The grader
// runs this twice and compares the dossier byte for byte, so the copy must be
// exact and the dossier must be built from the copied files, not the repo.
//
// Run locally with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Inside the grader, MAKEFUN_OUTPUT_DIR is unset and /output is used.

import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(outputDir, { recursive: true });
cpSync(join(repoRoot, 'game'), join(outputDir, 'game'), { recursive: true });
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoRoot, 'screenshots'))) {
  cpSync(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });
}

// The caps come from the competition's gate (reference/gate.json): the text cap
// is the only one that shapes the dossier's bytes; the rest make this program
// refuse exactly where the sealed scorer would (too many screenshots, one too
// big, game/ too large or with too many files, a path too long).
const dossier = buildDossier(outputDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outputDir, 'dossier.json'), dossier);

const dossierBytes = statSync(join(outputDir, 'dossier.json')).size;
console.log(`dossier.json: ${dossierBytes} bytes`);
if (dossierBytes > 1450000) {
  console.warn('WARNING: dossier is over the 1,450,000 byte budget — shrink the screenshots first.');
}
