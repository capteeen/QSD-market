import 'server-only';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/**
 * /how renders /docs/physics.md and /docs/economics.md VERBATIM. The files are
 * read at request time. The docs directory is found by walking up from
 * process.cwd() (apps/web in dev, the repo root under turbo, or wherever the
 * standalone build runs) until a directory containing docs/physics.md is
 * found; `QSD_DOCS_DIR` overrides the search.
 */
export async function findDocsDir(start = process.cwd()): Promise<string> {
  const override = process.env.QSD_DOCS_DIR;
  if (override) return override;
  let dir = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, 'docs');
    try {
      await stat(path.join(candidate, 'physics.md'));
      return candidate;
    } catch {
      /* keep walking */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`docs directory not found walking up from ${start}; set QSD_DOCS_DIR`);
}

export async function readDocs(): Promise<{ physics: string; economics: string; source: { physics: string; economics: string } }> {
  const dir = await findDocsDir();
  const physicsPath = path.join(dir, 'physics.md');
  const economicsPath = path.join(dir, 'economics.md');
  const [physics, economics] = await Promise.all([readFile(physicsPath, 'utf8'), readFile(economicsPath, 'utf8')]);
  return { physics, economics, source: { physics: physicsPath, economics: economicsPath } };
}
