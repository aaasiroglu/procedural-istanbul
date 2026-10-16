#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '../..');
const GRID = path.join(ROOT, 'data/ibb-local/areas.json');
const AREAS = JSON.parse(fs.readFileSync(GRID, 'utf8'));

const areaArg = [...process.argv.slice(2)].find((value) => value.startsWith('--area='));
const areaId = areaArg?.slice('--area='.length);
const stage = [...process.argv.slice(2)].find((value) => ['fetch', 'compile', 'all'].includes(value));
const selected = areaId
  ? AREAS.filter((area) => area.id === areaId)
  : AREAS;

if (areaId && selected.length === 0) {
  throw new Error(`unknown grid area "${areaId}"`);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Command failed with status ${result.status}`);
}

if (!stage || stage === 'all' || stage === 'fetch') {
  if (!fs.existsSync(GRID) || process.argv.includes('--regrid')) {
    run(process.env.PYTHON ?? 'python', [path.join(ROOT, 'tools/pipeline/ibb_grid.py'), '--cell', String(AREAS[0]?.cell ?? 10000)]);
  }
  for (const area of selected) {
    try {
      run(process.execPath, ['tools/pipeline/fetch.mjs', `--area=${area.id}`]);
    } catch (e) {
      console.warn(`[warning] fetch failed for ${area.id}: ${e.message}`);
    }
  }
}
if (!stage || stage === 'all' || stage === 'compile') {
  for (const area of selected) {
    try {
      run(process.execPath, ['tools/pipeline/compile.mjs', `--area=${area.id}`, '--no-ads']);
    } catch (e) {
      console.warn(`[warning] compile failed for ${area.id}: ${e.message}`);
    }
  }
}

if (stage === 'fetch' || stage === 'compile') {
  console.log(`completed ${stage} for ${selected.length} grid cell${selected.length === 1 ? '' : 's'}`);
} else {
  console.log(`completed all stages for ${selected.length} grid cell${selected.length === 1 ? '' : 's'}`);
}
