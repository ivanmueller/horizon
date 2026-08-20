/* Design-token lint for css/tours/.
 *
 * Catches the two mistakes that are easy to make and hard to see, because
 * a bad custom property does not error — it silently resolves to nothing
 * and the element renders unstyled:
 *
 *   1. var(--typo) with no fallback and no definition anywhere.
 *   2. A component reaching past the semantic layer into a raw primitive
 *      ramp. That is what quietly welds the design to one palette and
 *      makes the next rebrand a rewrite.
 *
 *   node tools/check-tokens.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'css/tours';
const files = readdirSync(DIR).filter((f) => f.endsWith('.css')).sort();

/* Ramps that only the semantic layer may name. Everything downstream must
   go through a role token instead. */
const PRIMITIVE_RE = /^--(neutral|brand|accent|success|warning|danger|info|text-(xs|sm|base|lg|xl|\dxl)|space-\d|weight|leading|tracking|shadow-\d|radius|duration|ease|font|z)-?/;
const SEMANTIC_LAYER = new Set(['01-primitives.css', '02-semantic.css']);

const defined = new Set();
const sources = new Map();
for (const f of files) {
  const css = readFileSync(join(DIR, f), 'utf8');
  sources.set(f, css);
  for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]);
}

const problems = [];

for (const [f, css] of sources) {
  const lines = css.split('\n');
  lines.forEach((line, i) => {
    // var(--x) with NO fallback — a typo here renders as nothing.
    for (const m of line.matchAll(/var\((--[a-z0-9-]+)\s*\)/g)) {
      if (!defined.has(m[1])) {
        problems.push({ f, n: i + 1, msg: `undefined token ${m[1]} (no fallback)`, line: line.trim() });
      }
    }
    // Component/layout files must not name primitives directly.
    if (!SEMANTIC_LAYER.has(f)) {
      for (const m of line.matchAll(/var\((--[a-z0-9-]+)/g)) {
        if (PRIMITIVE_RE.test(m[1]) && !/^--(space|radius|duration|ease|z|font|weight|leading|tracking|shadow)-/.test(m[1])) {
          problems.push({ f, n: i + 1, msg: `reaches past the semantic layer to ${m[1]}`, line: line.trim() });
        }
      }
    }
  });
}

console.log(`checked ${files.length} files, ${defined.size} tokens defined`);
if (!problems.length) {
  console.log('✓ every var() resolves, and nothing bypasses the semantic layer');
  process.exit(0);
}
for (const p of problems) console.log(`✗ ${p.f}:${p.n}  ${p.msg}\n    ${p.line}`);
console.log(`\n${problems.length} problem(s)`);
process.exit(1);
