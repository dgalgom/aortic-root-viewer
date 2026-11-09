// Builds dist/index.html: one self-contained page, as published.
// The files in src/js are ordered fragments of a single script scope (not ES modules);
// they are concatenated in name order and wrapped in one strict-mode IIFE.
import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');

const parts = readdirSync(join(root, 'src/js')).filter((f) => f.endsWith('.js')).sort();
const app = "(() => {\n  'use strict';\n" + parts.map((f) => read('src/js/' + f)).join('') + '})();\n';

// Function replacers keep any "$" in the inserted text literal
const html = read('src/index.template.html')
  .replace('/*STYLES*/', () => read('src/styles.css'))
  .replace('/*METHODS_EN*/', () => read('src/methods/en.html'))
  .replace('/*METHODS_ES*/', () => read('src/methods/es.html'))
  .replace('/*APP*/', () => app);

mkdirSync(join(root, 'dist'), { recursive: true });
writeFileSync(join(root, 'dist/index.html'), html);
console.log(`dist/index.html written (${(html.length / 1024).toFixed(0)} KB, ${parts.length} script parts)`);
