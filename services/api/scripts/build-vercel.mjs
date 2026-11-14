// Builds the API for Vercel with the Build Output API (v3): one bundled Node function, every path routed to it,
// pinned to Singapore next to the database, plus the hourly and nightly crons. Run after the workspace packages build.
// Vercel picks up .vercel/output after the build command; `vercel deploy --prebuilt` deploys it from a laptop.
import { build } from "esbuild";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = `${root}.vercel/output`;
const fn = `${out}/functions/api.func`;
await rm(out, { recursive: true, force: true });
await mkdir(fn, { recursive: true });

await build({
  entryPoints: [`${root}src/vercel.ts`],
  outfile: `${fn}/index.mjs`,
  bundle: true, platform: "node", target: "node22", format: "esm", sourcemap: "linked", legalComments: "none",
  // Some dependencies still call require(); give the ESM bundle one.
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
  logLevel: "warning",
});

await writeFile(`${fn}/.vc-config.json`, JSON.stringify({
  runtime: "nodejs22.x", handler: "index.mjs", launcherType: "Nodejs", shouldAddHelpers: false,
  maxDuration: 60, regions: ["sin1"],
}, null, 2));

await writeFile(`${out}/config.json`, JSON.stringify({
  version: 3,
  routes: [{ src: "/(.*)", dest: "/api" }],
  crons: [
    { path: "/cron/hourly", schedule: "0 * * * *" },
    { path: "/cron/nightly", schedule: "0 0 * * *" },
  ],
}, null, 2));
console.log("vercel: .vercel/output written (function api, region sin1, 2 crons)");
