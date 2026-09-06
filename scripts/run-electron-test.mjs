import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const entry = path.resolve(process.argv[2]);
const output = path.join(path.dirname(entry), `.orion-test-${process.pid}.mjs`);
try {
  // Production Vite loads ?raw as text. Node/Electron otherwise executes the
  // MCP shim and exits successfully before any Claude assertions can run.
  await build({
    entryPoints: [entry], outfile: output, bundle: true, platform: 'node', format: 'esm', packages: 'external',
    plugins: [{ name: 'raw-imports', setup(builder) {
      builder.onResolve({ filter: /\?raw$/ }, (args) => ({ path: path.resolve(args.resolveDir, args.path.slice(0, -4)), namespace: 'raw' }));
      builder.onLoad({ filter: /.*/, namespace: 'raw' }, async (args) => ({ contents: await fs.readFile(args.path, 'utf8'), loader: 'text' }));
    } }],
  });
  const result = spawnSync(require('electron'), [output], { stdio: 'inherit', timeout: 120000 });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally { await fs.rm(output, { force: true }); }
