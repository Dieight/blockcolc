import { build } from '../../../node_modules/esbuild/lib/main.js';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
await build({entryPoints:[fileURLToPath(new URL('../../../packages/domain/src/index.ts',import.meta.url))],
  bundle:true,format:'esm',platform:'node',target:'node24',outfile:fileURLToPath(new URL('build/domain.mjs',root)),
  logLevel:'warning',sourcemap:false});
