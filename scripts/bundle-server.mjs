// Bundles the SDK and executor (with their dependencies) into one ESM file each, so the
// hosted console can load them natively without the bundler or a node_modules tree.
import { build } from 'esbuild';
import { copyFileSync } from 'node:fs';

const banner = { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" };
for (const pkg of ['sdk', 'executor']) {
  await build({
    entryPoints: [`${pkg}/dist/index.js`],
    outfile: `${pkg}/dist/server.mjs`,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    banner,
    logLevel: 'warning',
  });
  // The gRPC client resolves the proto next to its own module, which is now server.mjs.
  copyFileSync('sdk/src/ika/ika_dwallet.proto', `${pkg}/dist/ika_dwallet.proto`);
}
console.log('bundled sdk/dist/server.mjs and executor/dist/server.mjs');
