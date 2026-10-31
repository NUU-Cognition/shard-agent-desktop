#!/usr/bin/env node
// flint shard ad desktop [list|start|id|claim|release|end|gc] [args]
//   list                                       the permissions, the claims of the live Orbh sessions, clashes, and the open agent-desktop sessions
//   start [--cursor] [--no-trace] [--screenshots] [--session <orbh-id>]
//                                              start one agent-desktop session for an Orbh session (default: this one), or reuse the open one
//   id [--session <orbh-id>]                   print the agent-desktop session id of the Orbh session (for --session)
//   claim [<app>] [--headed] [--session <orbh-id>]
//                                              claim an app, and with --headed the one headed claim of this machine
//   release [<app>] [--headed] [--all] [--session <orbh-id>]
//                                              drop one app, the headed claim, or (no argument) every claim; the agent-desktop session stays
//   end [--session <orbh-id>]                  end the agent-desktop session and clear the claim
//   gc                                         end the open agent-desktop sessions of Orbh sessions that are not live
//
// The claim is the `desktop` key on the Orbh session interface, a JSON value:
//   {"session":"run-…","apps":["TextEdit"],"headed":false,"startedAt":"…"}
// It shows in `flint orbh inspect`, and it goes away with the Orbh session.
// Driving the desktop is not scripted: the holder runs `agent-desktop --session <id> …`. See knw-ad-cli.
'use strict';
const { spawnSync } = require('child_process');

const KEY = 'desktop';
const NAME_PREFIX = 'orbh-';
const ORBH_NAME = /^orbh-([0-9a-f]{8})$/;

// `out` is stdout ONLY: agent-desktop prints one JSON envelope there, and a warning on
// stderr must not break the parse. `msg` is for errors that a person reads.
function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60000 });
  const out = (r.stdout || '').trim();
  const err = (r.stderr || '').trim();
  return {
    ok: r.status === 0,
    status: r.status,
    out,
    err,
    msg: [out, err].filter(Boolean).join('\n'),
    missing: !!(r.error && r.error.code === 'ENOENT'),
  };
}

function fail(text) {
  console.error(text);
  process.exit(1);
}

// One agent-desktop command. It returns the envelope { ok, data | error }.
function ad(args) {
  const r = run('agent-desktop', args);
  if (r.missing) {
    return { ok: false, missing: true, error: { code: 'NOT_INSTALLED', message: 'agent-desktop is not on PATH. Do the setup of the shard: setup-ad.md' } };
  }
  try {
    return JSON.parse(r.out);
  } catch {
    return { ok: false, error: { code: 'BAD_OUTPUT', message: r.msg || `agent-desktop exited with ${r.status}` } };
  }
}

function adOrFail(args) {
  const e = ad(args);
  if (!e.ok) fail(`✘ agent-desktop ${args.join(' ')}: ${e.error ? `${e.error.code}: ${e.error.message}` : 'failed'}`);
  return e;
}

// The live Orbh sessions, with their interface. null means "not known": then no
// command ends or refuses on the claims of other sessions.
function activeSessions() {
  const r = run('flint', ['orbh', 'active', '--json']);
  if (!r.ok) return null;
  try {
    const d = JSON.parse(r.out);
    return Array.isArray(d) ? d : (d.sessions || []);
  } catch {
    return null;
  }
}

function parseClaim(raw) {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw);
    if (!c || typeof c !== 'object') return null;
    return {
      session: typeof c.session === 'string' && c.session ? c.session : null,
      apps: Array.isArray(c.apps) ? c.apps.filter((a) => typeof a === 'string' && a) : [],
      headed: c.headed === true,
      startedAt: c.startedAt || null,
    };
  } catch {
    return null;
  }
}

function emptyClaim() {
  return { session: null, apps: [], headed: false, startedAt: null };
}

function isEmpty(c) {
  return !c.session && !c.apps.length && !c.headed;
}

function readClaim(sessionId) {
  const r = run('flint', ['orbh', 'session', sessionId, 'get', KEY]);
  return r.ok ? parseClaim(r.out) : null;
}

function writeClaim(sessionId, claim) {
  const value = claim && !isEmpty(claim) ? JSON.stringify(claim) : '';
  const r = run('flint', ['orbh', 'session', sessionId, 'set', KEY, value]);
  if (!r.ok) fail(`✘ The write of the ${KEY} key failed: ${r.msg}`);
}

function claimsOf(sessions) {
  const out = [];
  for (const s of sessions || []) {
    const c = parseClaim(s.interface && s.interface[KEY]);
    if (c && !isEmpty(c)) out.push({ session: s, claim: c });
  }
  return out;
}

function label(s) {
  const title = s.title || s.name || '';
  return title ? `${s.shortId || s.id.slice(0, 8)} "${title}"` : `${s.shortId || s.id.slice(0, 8)}`;
}

function sameApp(a, b) {
  return a.toLowerCase() === b.toLowerCase();
}

function isSelf(sessionId, target) {
  return sessionId === target || sessionId.startsWith(target) || target.startsWith(sessionId);
}

// Resolve a full or partial Orbh session id to the full id, when the session is live.
function resolveTarget(target, sessions) {
  if (!target) return null;
  const hit = (sessions || []).find((s) => s.id === target || s.id.startsWith(target));
  return hit ? hit.id : target;
}

function openDesktopSessions() {
  const e = ad(['session', 'list']);
  if (!e.ok) return { ok: false, error: e.error, open: [], ended: [] };
  const all = (e.data && e.data.sessions) || [];
  return { ok: true, open: all.filter((s) => !s.ended_at), ended: all.filter((s) => s.ended_at) };
}

function needTarget(target) {
  if (!target) fail('✘ No Orbh session. Pass --session <orbh-id>, or run inside an Orbh session.');
}

// ---------------------------------------------------------------- commands

function list() {
  const ver = ad(['version']);
  if (ver.missing) fail(`✘ ${ver.error.message}`);
  const perms = ad(['permissions']);
  const p = (perms.ok && perms.data) || {};
  const st = (k) => (p[k] && p[k].state) || 'unknown';
  console.log(`Desktop · agent-desktop ${(ver.data && ver.data.version) || '?'} · accessibility ${st('accessibility')} · screen recording ${st('screen_recording')}`);
  if (st('accessibility') !== 'granted') {
    console.log('  ⚠ Accessibility is not granted for the app that started this process. Read setup-ad.md.');
  }

  const sessions = activeSessions();
  if (sessions === null) console.log('  ⚠ flint orbh active failed: the claims of other sessions are not known.');
  const held = claimsOf(sessions);

  console.log('\nClaims of the live Orbh sessions');
  if (!held.length) console.log('  (none)');
  for (const { session, claim } of held) {
    const apps = claim.apps.length ? claim.apps.join(', ') : '(no app)';
    console.log(`  ${label(session)}  ${claim.session || '(no agent-desktop session)'}  apps: ${apps}${claim.headed ? '  HEADED' : ''}`);
  }

  const byApp = new Map();
  for (const { session, claim } of held) {
    for (const a of claim.apps) {
      const k = a.toLowerCase();
      if (!byApp.has(k)) byApp.set(k, { app: a, holders: [] });
      byApp.get(k).holders.push(session);
    }
  }
  for (const { app, holders } of byApp.values()) {
    if (holders.length > 1) console.log(`  ⚠ Clash: "${app}" is claimed by ${holders.map(label).join(' and ')}.`);
  }
  const headed = held.filter((c) => c.claim.headed);
  console.log(`  Headed claim: ${headed.length ? headed.map((c) => label(c.session)).join(', ') : 'none'}`);
  if (headed.length > 1) console.log('  ⚠ More than one session holds the headed claim.');

  const ds = openDesktopSessions();
  console.log('\nOpen agent-desktop sessions');
  if (!ds.ok) {
    console.log(`  ⚠ agent-desktop session list failed: ${ds.error ? ds.error.message : 'unknown'}`);
    return;
  }
  if (!ds.open.length) console.log('  (none)');
  const live = new Set((sessions || []).map((s) => s.shortId || s.id.slice(0, 8)));
  for (const s of ds.open) {
    const owner = held.find((c) => c.claim.session === s.session_id);
    const m = (s.name || '').match(ORBH_NAME);
    let note;
    if (owner) note = `→ ${label(owner.session)}`;
    else if (m && sessions !== null && !live.has(m[1])) note = '⚠ its Orbh session is not live (flint shard ad desktop gc)';
    else if (m) note = '(a live Orbh session that does not claim it)';
    else note = '(not from an Orbh session: leave it)';
    console.log(`  ${s.session_id}  ${s.name || '(no name)'}  trace ${s.trace}  ${note}`);
  }
  const openIds = new Set(ds.open.map((s) => s.session_id));
  for (const { session, claim } of held) {
    if (claim.session && !openIds.has(claim.session)) {
      console.log(`  ⚠ ${label(session)} names ${claim.session}, but that session is not open (flint shard ad desktop start)`);
    }
  }
  if (ds.ended.length) console.log(`  ${ds.ended.length} ended session(s) keep their traces. \`agent-desktop session gc --ended\` deletes them.`);
}

function start(target, opts) {
  needTarget(target);
  const sessions = activeSessions();
  target = resolveTarget(target, sessions);
  const cur = readClaim(target) || emptyClaim();
  const ds = openDesktopSessions();
  if (cur.session && ds.ok && ds.open.some((s) => s.session_id === cur.session)) {
    console.log(`✓ The Orbh session ${target.slice(0, 8)} already has the agent-desktop session ${cur.session}.`);
    console.log(`  drive with:  agent-desktop --session ${cur.session} <command>`);
    return;
  }
  const args = ['session', 'start', '--name', `${NAME_PREFIX}${target.slice(0, 8)}`];
  if (opts.noTrace) args.push('--no-trace');
  if (opts.screenshots) args.push('--screenshots');
  if (opts.cursor) args.push('--cursor');
  const e = adOrFail(args);
  const claim = { ...cur, session: e.data.session_id, startedAt: new Date().toISOString() };
  writeClaim(target, claim);
  console.log(`✓ Started the agent-desktop session ${e.data.session_id} for the Orbh session ${target.slice(0, 8)} (trace ${e.data.trace}${opts.cursor ? ', cursor overlay' : ''}).`);
  console.log(`  drive with:  agent-desktop --session ${e.data.session_id} <command>`);
  console.log('  next:        flint shard ad desktop claim "<App>"');
}

function id(target) {
  needTarget(target);
  const cur = readClaim(target);
  if (!cur || !cur.session) fail('✘ This Orbh session has no agent-desktop session. Next: flint shard ad desktop start');
  console.log(cur.session);
}

function claim(app, target, opts) {
  needTarget(target);
  if (!app && !opts.headed) fail('Usage: flint shard ad desktop claim <app> [--headed] [--session <orbh-id>]');
  const sessions = activeSessions();
  target = resolveTarget(target, sessions);
  const others = claimsOf(sessions).filter((c) => !isSelf(c.session.id, target));

  if (opts.headed) {
    const h = others.filter((c) => c.claim.headed);
    if (h.length) {
      fail(`✘ ${h.map((c) => label(c.session)).join(', ')} holds the headed claim. Only one session can send physical input on this machine at a time.\n`
        + `  Ask that session to release it: flint orbh message send ${h[0].session.id} "<why you need the headed claim>"\n`
        + `  When that session no longer works on the desktop, a person can release it: flint shard ad desktop release --headed --session ${h[0].session.id}`);
    }
    if (sessions === null) fail('✘ flint orbh active failed, so no check of the headed claim is possible. Try again.');
  }

  if (app) {
    const holders = others.filter((c) => c.claim.apps.some((a) => sameApp(a, app)));
    if (holders.length) {
      console.log(`⚠ "${app}" is also claimed by ${holders.map((c) => label(c.session)).join(', ')}. Agree with that session before you act in the app: flint orbh message send ${holders[0].session.id} "<…>"`);
    }
  }

  const cur = readClaim(target) || emptyClaim();
  if (app && !cur.apps.some((a) => sameApp(a, app))) cur.apps.push(app);
  if (opts.headed) cur.headed = true;
  writeClaim(target, cur);

  const parts = [];
  if (app) parts.push(`"${app}"`);
  if (opts.headed) parts.push('the headed claim');
  console.log(`✓ The Orbh session ${target.slice(0, 8)} claims ${parts.join(' and ')}. Apps: ${cur.apps.join(', ') || '(none)'}${cur.headed ? ' · HEADED' : ''}`);
  if (opts.headed) console.log('  Use --headed only for a step that needs physical input, and only when the person permits it. Release it after that step: flint shard ad desktop release --headed');
  if (!cur.session) console.log('  This Orbh session has no agent-desktop session yet. Next: flint shard ad desktop start');
}

function release(app, target, opts) {
  needTarget(target);
  target = resolveTarget(target, activeSessions());
  const cur = readClaim(target);
  if (!cur || isEmpty(cur)) {
    console.log(`The Orbh session ${target.slice(0, 8)} holds no desktop claim. Nothing to release.`);
    return;
  }
  const dropped = [];
  if (opts.all || (!app && !opts.headed)) {
    dropped.push(...cur.apps.map((a) => `"${a}"`));
    if (cur.headed) dropped.push('the headed claim');
    cur.apps = [];
    cur.headed = false;
  } else {
    if (app) {
      const before = cur.apps.length;
      cur.apps = cur.apps.filter((a) => !sameApp(a, app));
      if (cur.apps.length !== before) dropped.push(`"${app}"`);
    }
    if (opts.headed && cur.headed) {
      cur.headed = false;
      dropped.push('the headed claim');
    }
  }
  writeClaim(target, cur);
  console.log(dropped.length
    ? `✓ Released ${dropped.join(', ')} from the Orbh session ${target.slice(0, 8)}.`
    : `The Orbh session ${target.slice(0, 8)} did not hold that claim. Nothing changed.`);
  if (cur.session) console.log(`  The agent-desktop session ${cur.session} stays open. End it with: flint shard ad desktop end`);
}

function end(target) {
  needTarget(target);
  target = resolveTarget(target, activeSessions());
  const cur = readClaim(target);
  if (!cur || isEmpty(cur)) {
    console.log(`The Orbh session ${target.slice(0, 8)} holds no desktop claim and no agent-desktop session. Nothing to end.`);
    return;
  }
  if (cur.session) {
    const e = ad(['session', 'end', cur.session]);
    if (!e.ok) console.log(`⚠ agent-desktop session end ${cur.session}: ${e.error ? `${e.error.code}: ${e.error.message}` : 'failed'}`);
  }
  writeClaim(target, null);
  const apps = cur.apps.length ? `; released ${cur.apps.map((a) => `"${a}"`).join(', ')}` : '';
  console.log(`✓ Ended ${cur.session || '(no agent-desktop session)'} for the Orbh session ${target.slice(0, 8)}${apps}${cur.headed ? ' and the headed claim' : ''}.`);
  if (cur.session) console.log(`  The trace files stay in ~/.agent-desktop/sessions/${cur.session}/trace/ (agent-desktop reads no trace of an ended session).`);
}

function gc() {
  const sessions = activeSessions();
  if (sessions === null) fail('✘ flint orbh active failed, so the live sessions are not known. Nothing was ended.');
  const live = new Set(sessions.map((s) => s.shortId || s.id.slice(0, 8)));
  const claimed = new Set(claimsOf(sessions).map((c) => c.claim.session).filter(Boolean));
  const ds = openDesktopSessions();
  if (!ds.ok) fail(`✘ agent-desktop session list failed: ${ds.error ? ds.error.message : 'unknown'}`);
  let n = 0;
  for (const s of ds.open) {
    const m = (s.name || '').match(ORBH_NAME);
    if (!m || live.has(m[1]) || claimed.has(s.session_id)) continue;
    const e = ad(['session', 'end', s.session_id]);
    console.log(e.ok ? `✓ Ended ${s.session_id} (${s.name}): its Orbh session is not live.` : `⚠ ${s.session_id}: ${e.error ? e.error.message : 'end failed'}`);
    if (e.ok) n++;
  }
  console.log(n ? `${n} session(s) ended. No trace was deleted.` : 'No open agent-desktop session of an Orbh session that is not live.');
}

// ---------------------------------------------------------------- main

const argv = process.argv.slice(2);
const opts = { cursor: false, noTrace: false, screenshots: false, headed: false, all: false };
let sessionFlag = null;
const pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--session') sessionFlag = argv[++i];
  else if (a === '--cursor') opts.cursor = true;
  else if (a === '--no-trace') opts.noTrace = true;
  else if (a === '--screenshots') opts.screenshots = true;
  else if (a === '--headed') opts.headed = true;
  else if (a === '--all') opts.all = true;
  else if (a.startsWith('--')) fail(`Unknown flag "${a}".`);
  else pos.push(a);
}
if (opts.screenshots && opts.noTrace) fail('✘ --screenshots needs the trace: do not pass --no-trace with it.');

const cmd = (pos[0] || 'list').toLowerCase();
const target = sessionFlag || process.env.ORBH_SESSION_ID || null;
const arg = pos.slice(1).join(' ') || null; // an app name can have spaces: claim System Settings

switch (cmd) {
  case 'list': list(); break;
  case 'start': start(target, opts); break;
  case 'id': id(target); break;
  case 'claim': claim(arg, target, opts); break;
  case 'release': release(arg, target, opts); break;
  case 'end': end(target); break;
  case 'gc': gc(); break;
  default:
    fail(`Unknown command "${cmd}". Use: list | start [--cursor] [--no-trace] [--screenshots] | id | claim <app> [--headed] | release [<app>] [--headed] [--all] | end | gc   (each takes --session <orbh-id>)`);
}
