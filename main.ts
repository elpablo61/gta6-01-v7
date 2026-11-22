// Crescent Bay (gta6-01-v7) — entrypoint. Node 22, standard library only.
//
// What this program does, in plain terms: the playable game is the plain
// static files under game/ (index.html plus ES modules, no library, no
// network request, no external assets). This program is the handoff to
// the grader: it copies game/ and screenshots/ from beside this file
// into the output directory, then writes /output/dossier.json using
// make.fun's vendored library (vendor/makefun-game.ts — the scorer's own
// copy, never edited). The grader runs this program twice and compares
// the dossier byte for byte, so the copy has to be exact and the dossier
// has to be built from the copied files, never from the repo directly.
//
// Run it locally with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Inside the grader MAKEFUN_OUTPUT_DIR is unset and /output is used.

import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Fresh output directory, then the two trees the grader needs.
mkdirSync(outputDir, { recursive: true });
cpSync(join(repoRoot, 'game'), join(outputDir, 'game'), { recursive: true });
mkdirSync(join(outputDir, 'screenshots'), { recursive: true });
if (existsSync(join(repoRoot, 'screenshots'))) {
  cpSync(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'), { recursive: true });
}

// The caps come from the competition's gate (reference/gate.json). The
// text cap is the one that shapes the dossier's bytes; the rest make this
// program refuse in exactly the places the sealed scorer would — too many
// screenshots, one screenshot too big, game/ too large or with too many
// files, or a path that is too long.
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

// Small size report so a builder can see at a glance what went in.
function treeBytes(dir) {
  let total = 0;
  let files = 0;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else { total += statSync(p).size; files += 1; }
    }
  };
  if (existsSync(dir)) walk(dir);
  return { total, files };
}
const gameTree = treeBytes(join(outputDir, 'game'));
const shotTree = treeBytes(join(outputDir, 'screenshots'));
console.log(`game/: ${gameTree.files} files, ${gameTree.total} bytes`);
console.log(`screenshots/: ${shotTree.files} files, ${shotTree.total} bytes`);
