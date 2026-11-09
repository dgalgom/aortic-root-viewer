// Aortic root viewer v2.0. Copyright 2026 Daniel Gallardo Gómez.
// Licensed under the Apache License, Version 2.0 (see LICENSE). SPDX-License-Identifier: Apache-2.0
// Extracts the inline app script from dist/index.html and checks that it parses.
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const html = readFileSync(require('node:path').join(__dirname, '../dist/index.html'), 'utf8');
const app = html.match(/<script>\n([\s\S]*?)\n<\/script>/)[1];
new vm.Script(app, { filename: 'app.js' });
console.log('Syntax OK (' + app.split('\n').length + ' lines)');
