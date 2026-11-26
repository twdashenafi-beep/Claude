// The Mac app's side of the agent inbox: listing, moving and writing files in
// the DayFlow folder, against a real temporary folder. Run with `npm test`.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createAgentFolder, findDriveRoots, inside, MAX_FILE_BYTES } = require('../../desktop/agentFolder.js');

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dayflow-agent-'));
const at = new Date('2026-11-26T09:00:00Z');
const folder = createAgentFolder(root, { now: () => at });
folder.ensure();
const inbox = folder.dirs.inbox;
const put = (name, text) => fs.writeFileSync(path.join(inbox, name), text);

put('deal-42.json', '{"type":"new_task"}');
put('notes.txt', 'not json');
put('.hidden.json', '{}');
fs.mkdirSync(path.join(inbox, 'folder.json'));
put('huge.json', ' '.repeat(MAX_FILE_BYTES + 1));
try { fs.symlinkSync('/etc/hosts', path.join(inbox, 'link.json')); } catch { /* not every system allows it */ }

const listed = folder.list();
ok('the waiting .json file is listed, with its text', listed.length === 1 && listed[0].name === 'deal-42.json' && listed[0].text.includes('new_task'));
ok('other files, hidden files, folders and links are left alone', !listed.some(f => ['notes.txt', '.hidden.json', 'folder.json', 'link.json'].includes(f.name)));
ok('an oversize file is rejected without being read', fs.existsSync(path.join(folder.dirs.rejected, 'huge.json'))
  && fs.readFileSync(path.join(folder.dirs.rejected, 'huge.json.reason.txt'), 'utf8').includes('limit'));

ok('settling to processed moves the file', folder.settle('deal-42.json', 'processed').ok
  && fs.existsSync(path.join(folder.dirs.processed, 'deal-42.json')) && !fs.existsSync(path.join(inbox, 'deal-42.json')));

put('deal-42.json', '{"again":true}');
const second = folder.settle('deal-42.json', 'processed');
ok('a second file of the same name does not overwrite the first', second.ok && second.movedTo !== 'deal-42.json'
  && fs.readFileSync(path.join(folder.dirs.processed, 'deal-42.json'), 'utf8').includes('new_task'));

put('bad.json', '{ nope');
const r = folder.settle('bad.json', 'rejected', 'The file is not valid JSON.');
ok('a rejected file moves with its reason beside it', r.ok
  && fs.readFileSync(path.join(folder.dirs.rejected, 'bad.json.reason.txt'), 'utf8').includes('not valid JSON'));

ok('a path cannot be smuggled in as a name', !folder.settle('../export/x.json', 'processed').ok && inside(inbox, '../x.json') === null);
ok('an absolute path is refused', !folder.settle('/etc/passwd.json', 'processed').ok);
ok('an unknown outcome is refused', (() => { put('c.json', '{}'); return !folder.settle('c.json', 'deleted').ok; })());
ok('a missing file is refused, not thrown', !folder.settle('missing.json', 'processed').ok);

ok('the export is written whole', folder.writeExport('{"tasks":[]}').ok
  && fs.readFileSync(path.join(folder.dirs.exported, 'dayflow-export.json'), 'utf8') === '{"tasks":[]}');
ok('no temporary file is left behind', !fs.existsSync(path.join(folder.dirs.exported, '.dayflow-export.json.tmp')));
ok('an export that is not text is refused', !folder.writeExport({ tasks: [] }).ok);

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dayflow-home-'));
ok('no Google Drive means no folder found', findDriveRoots(home).length === 0);
fs.mkdirSync(path.join(home, 'Library', 'CloudStorage', 'GoogleDrive-me@example.com', 'My Drive'), { recursive: true });
ok('one Google Drive account is found', findDriveRoots(home).length === 1);

fs.rmSync(root, { recursive: true, force: true });
fs.rmSync(home, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
