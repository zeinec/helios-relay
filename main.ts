// HELIOS RELAY — entrypoint: copies game/ + screenshots/ into the output
// directory and writes dossier.json via the makefun dossier builder.
// Deterministic: no timestamps, no random data. Node 22, stdlib only.
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));
// Empty env var falls back to /output too; resolve so relative paths work.
const outDir = resolve(process.env.MAKEFUN_OUTPUT_DIR || '/output');

mkdirSync(outDir, { recursive: true });
cpSync(join(repoDir, 'game'), join(outDir, 'game'), { recursive: true });

const shotsDir = join(repoDir, 'screenshots');
if (existsSync(shotsDir)) {
  cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });
} else {
  mkdirSync(join(outDir, 'screenshots'), { recursive: true });
}

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
});
// Write the dossier bytes exactly as buildDossier returns them: appending
// a string ('dossier + "\n"') would coerce the Uint8Array to comma-joined
// decimal byte values instead of the canonical JSON.
writeFileSync(join(outDir, 'dossier.json'), dossier);
