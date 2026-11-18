// Bundles the SDK and executor (with their dependencies) into one ESM file each, so the
// hosted console can load them natively without the bundler or a node_modules tree.
import { build } from 'esbuild';
import { copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// CommonJS dependencies inside the bundle expect `require`, `__filename` and `__dirname`.
const banner = {
  js: [
    "import { createRequire as __cr } from 'node:module';",
    "import { fileURLToPath as __fu } from 'node:url';",
    "import { dirname as __dn } from 'node:path';",
    'const require = __cr(import.meta.url);',
    'const __filename = __fu(import.meta.url);',
    'const __dirname = __dn(__filename);',
  ].join(' '),
};
for (const pkg of ['sdk', 'executor']) {
  const { metafile } = await build({
    entryPoints: [`${pkg}/dist/index.js`],
    outfile: `${pkg}/dist/server.mjs`,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    banner,
    metafile: true,
    logLevel: 'warning',
  });
  // The Ika SDK derives the issuer's keys in WebAssembly, and its Node loader reads the module
  // from the directory of the file that loads it, which is now dist/server.mjs.
  const glue = Object.keys(metafile.inputs).find((file) => file.endsWith('dist/node/dwallet_mpc_wasm.js'));
  if (glue) copyFileSync(join(dirname(glue), 'dwallet_mpc_wasm_bg.wasm'), `${pkg}/dist/dwallet_mpc_wasm_bg.wasm`);
}
console.log('bundled sdk/dist/server.mjs and executor/dist/server.mjs');
