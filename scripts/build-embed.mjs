// Build the static export tuned for embedding in another site's iframe
// (jarrettwhite.com → /projects/merscribe). Two knobs, both env-driven so the
// default `next build` / desktop build stays byte-for-byte unchanged:
//   BASE_PATH=/merscribe   → next.config.ts prefixes every asset URL, so the
//                            bundle works when served from a sub-path.
//   NEXT_PUBLIC_EMBED=1     → TopToolbar drops the file open/save UI (the demo
//                            never writes to disk); the Copy button stays.
// After this runs, copy out/ into the website's frontend/public/merscribe/.
import { execFileSync } from 'node:child_process'

const BASE_PATH = process.env.BASE_PATH || '/merscribe';

execFileSync('next', ['build'], {
  stdio: 'inherit',
  shell: true, // resolve next.cmd on Windows
  env: { ...process.env, BASE_PATH, NEXT_PUBLIC_EMBED: '1' },
});

console.log(`\n✓ Embed build complete (basePath=${BASE_PATH}). Copy out/ → website frontend/public/merscribe/`);
