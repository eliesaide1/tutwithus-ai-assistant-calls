import { build } from 'esbuild';

const [entry, outfile] = process.argv.slice(2);
if (!entry || !outfile) {
  console.error('Usage: node scripts/bundle-node.mjs <entry.ts> <outfile.mjs>');
  process.exit(1);
}

const externalizeThirdParty = {
  name: 'externalize-third-party',
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /^[^./]/ }, (args) => {
      if (args.path.startsWith('@tutwithus/')) {
        return undefined;
      }
      return { path: args.path, external: true };
    });
  },
};

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  plugins: [externalizeThirdParty],
  logLevel: 'info',
});
