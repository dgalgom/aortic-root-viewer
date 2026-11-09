// Extracts the inline app script from dist/index.html and checks that it parses.
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const html = readFileSync(require('node:path').join(__dirname, '../dist/index.html'), 'utf8');
const app = html.match(/<script>\n([\s\S]*?)\n<\/script>/)[1];
new vm.Script(app, { filename: 'app.js' });
console.log('Syntax OK (' + app.split('\n').length + ' lines)');
