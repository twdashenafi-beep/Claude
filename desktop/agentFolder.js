'use strict';

// The one place on this Mac the app is allowed to read and write: the DayFlow
// folder inside Google Drive for desktop.
//
// The window loads a web page, and a web page has no business with the file
// system, so this is deliberately narrow. It can list the .json files waiting in
// agent-inbox/, read them up to a size limit, move one it has read to
// processed/ or rejected/, and write exactly one file, export/dayflow-export.json.
// Nothing it is handed can name a path: a file is only ever referred to by a
// name this module listed itself, and that name is checked again before every
// move. Google Drive for desktop does the syncing; there is no login here and
// no key anywhere.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const MAX_FILE_BYTES = 256 * 1024;
const MAX_EXPORT_BYTES = 20 * 1024 * 1024;
const MAX_FILES_PER_CHECK = 50;
const MAX_REASON = 4000;
const NAME = /^(?![.~])[^/\\\0:]{1,150}\.json$/i;

function inside(dir, name) {
  if (typeof name !== 'string' || !NAME.test(name) || path.basename(name) !== name) return null;
  const full = path.join(dir, name);
  return path.dirname(full) === dir ? full : null;
}

// A name in `dir` that is not taken: a second "deal.json" becomes
// "deal-2026-11-26T09-00-00-000Z.json" rather than overwriting the first.
function freeName(dir, name, now) {
  if (!fs.existsSync(path.join(dir, name))) return name;
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const base = name.replace(/\.json$/i, '');
  let candidate = `${base}-${stamp}.json`;
  for (let n = 2; fs.existsSync(path.join(dir, candidate)); n += 1) candidate = `${base}-${stamp}-${n}.json`;
  return candidate;
}

function createAgentFolder(root, { now = () => new Date() } = {}) {
  const dirs = {
    root,
    inbox: path.join(root, 'agent-inbox'),
    processed: path.join(root, 'agent-inbox', 'processed'),
    rejected: path.join(root, 'agent-inbox', 'rejected'),
    exported: path.join(root, 'export'),
  };

  function ensure() {
    for (const dir of [dirs.inbox, dirs.processed, dirs.rejected, dirs.exported]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  function settle(name, outcome, reason = '') {
    const from = inside(dirs.inbox, name);
    if (!from) return { ok: false, error: 'not an inbox file name' };
    let stat;
    try {
      stat = fs.lstatSync(from);
    } catch {
      return { ok: false, error: 'no such file in the inbox' };
    }
    if (!stat.isFile()) return { ok: false, error: 'not a file' };

    const toDir = outcome === 'processed' ? dirs.processed : outcome === 'rejected' ? dirs.rejected : null;
    if (!toDir) return { ok: false, error: 'outcome must be processed or rejected' };
    ensure();
    const at = now();
    const to = freeName(toDir, name, at);
    fs.renameSync(from, path.join(toDir, to));
    if (outcome === 'rejected') {
      const why = String(reason || 'No reason given.').slice(0, MAX_REASON);
      fs.writeFileSync(
        path.join(toDir, `${to}.reason.txt`),
        `Rejected by DayFlow on ${at.toISOString()}\n\n${why}\n`,
      );
    }
    return { ok: true, movedTo: to };
  }

  // Every .json file waiting, read as text. Anything too large is rejected here
  // and never read; links, folders and names this module would not accept are
  // left alone.
  function list() {
    ensure();
    const out = [];
    for (const entry of fs.readdirSync(dirs.inbox, { withFileTypes: true })) {
      if (out.length >= MAX_FILES_PER_CHECK) break;
      if (!entry.isFile() || !inside(dirs.inbox, entry.name)) continue;
      const full = path.join(dirs.inbox, entry.name);
      const { size } = fs.statSync(full);
      if (size > MAX_FILE_BYTES) {
        settle(entry.name, 'rejected', `The file is ${Math.ceil(size / 1024)} KB; the limit is ${MAX_FILE_BYTES / 1024} KB.`);
        continue;
      }
      out.push({ name: entry.name, text: fs.readFileSync(full, 'utf8') });
    }
    return out;
  }

  // Written beside itself and renamed into place, so an agent reading the file
  // while it is being written sees the old one or the new one, never half.
  function writeExport(text) {
    if (typeof text !== 'string') return { ok: false, error: 'export must be text' };
    if (Buffer.byteLength(text, 'utf8') > MAX_EXPORT_BYTES) return { ok: false, error: 'export is too large' };
    ensure();
    const final = path.join(dirs.exported, 'dayflow-export.json');
    const temp = path.join(dirs.exported, '.dayflow-export.json.tmp');
    fs.writeFileSync(temp, text);
    fs.renameSync(temp, final);
    return { ok: true };
  }

  return { dirs, ensure, list, settle, writeExport };
}

// Where Google Drive for desktop keeps My Drive on a Mac. Only offered when
// there is exactly one account: with two, guessing would put somebody's tasks
// in the wrong Drive, so the person is asked instead.
function findDriveRoots(home = os.homedir()) {
  const cloud = path.join(home, 'Library', 'CloudStorage');
  let names = [];
  try {
    names = fs.readdirSync(cloud);
  } catch {
    return [];
  }
  return names
    .filter(n => n.startsWith('GoogleDrive-'))
    .map(n => path.join(cloud, n, 'My Drive'))
    .filter(p => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    });
}

module.exports = {
  createAgentFolder, findDriveRoots, inside,
  MAX_FILE_BYTES, MAX_EXPORT_BYTES, MAX_FILES_PER_CHECK,
};
