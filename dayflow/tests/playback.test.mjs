// One voice note at a time.
//
// Every note owns its own player, which is what lets a row play without knowing
// anything about the rest of the list — and which also meant that tapping a
// second note while the first was talking played both at once. The registry
// here is the whole of the fix, so what it has to survive is the awkward part:
// a player stopping another player makes that one release itself, in the middle
// of the loop doing the stopping.
//
// Run with `npm test`.
import { claim, release, playingNow } from '../src/services/playback.js';

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${label}${cond ? '' : '  ' + extra}`);
};

// A stand-in for a note: it knows whether it is making a noise, and stopping it
// releases it, exactly as the component does.
function note() {
  const it = {
    playing: false,
    stops: 0,
    stop() {
      it.playing = false;
      it.stops += 1;
      release(it.stop);
    },
    play() {
      claim(it.stop);
      it.playing = true;
    },
  };
  return it;
}

// ── Nothing, to start ──
ok('nothing is playing to begin with', playingNow() === 0);

// ── One at a time ──
const a = note(), b = note(), c = note();
a.play();
ok('playing one holds the floor', playingNow() === 1);
ok('and it is playing', a.playing);

b.play();
ok('playing a second stops the first', !a.playing && b.playing);
ok('and it was stopped once, not repeatedly', a.stops === 1, String(a.stops));
ok('only one holds the floor', playingNow() === 1, String(playingNow()));

c.play();
ok('and again for a third', !b.playing && c.playing);
ok('the one already stopped is not stopped again', a.stops === 1, String(a.stops));

c.stop();
ok('stopping the last leaves silence', playingNow() === 0);

// ── Finishing on its own ──
//
// A note that reaches its end is not stopped by anybody; it just has to stop
// holding the floor, or the next one to play would try to stop something that
// is already finished.
const d = note();
d.play();
release(d.stop);
ok('a note that finished releases the floor', playingNow() === 0);

// ── Playing the same one twice ──
const e = note();
e.play();
e.play();
ok('playing the same note again does not stop itself', e.playing && e.stops === 0);
ok('and it is still counted once', playingNow() === 1, String(playingNow()));
release(e.stop);

// ── A player that has gone ──
//
// The sheet can be closed while a note is playing. Its stop function is then
// pointing at a player that no longer exists, and the next note to play must
// not be taken down with it.
const gone = () => { throw new Error('this player is no longer here'); };
claim(gone);
const f = note();
let threw = false;
try { f.play(); } catch { threw = true; }
ok('a player that throws on the way out is survived', !threw);
ok('and the one that wanted to play is playing', f.playing);
ok('with the floor to itself', playingNow() === 1, String(playingNow()));
release(f.stop);

// ── Junk ──
ok('claiming nothing changes nothing', (claim(null), playingNow() === 0));
ok('claiming a non-function changes nothing', (claim('stop'), playingNow() === 0));
ok('releasing something never claimed is harmless',
   (release(() => {}), playingNow() === 0));
ok('releasing twice is harmless', (() => {
  const g = note();
  g.play();
  release(g.stop);
  release(g.stop);
  return playingNow() === 0;
})());

// ── Many ──
//
// Five is the most notes one task can hold; the list and the sheet can both be
// on screen at once, so more players than that can exist. Whatever the number,
// exactly one survives.
const many = Array.from({ length: 12 }, note);
many.forEach(n => n.play());
ok('with a dozen players, one is playing',
   many.filter(n => n.playing).length === 1, String(many.filter(n => n.playing).length));
ok('and it is the last one asked', many[many.length - 1].playing);
ok('every other one was stopped exactly once',
   many.slice(0, -1).every(n => n.stops === 1));
many[many.length - 1].stop();
ok('and silence again at the end', playingNow() === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
