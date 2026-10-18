// harness-seam eval runner.
// Runs each case once through a dsh profile, then applies objective checks to
// stdout, fixture files, and the session log.
//
// Configuration (env or flags):
//   DSH_EXE        path to the DeepSeek Harness executable
//   DSH_CLI        path to dsh-desktop-host/lib/cli.js inside app.asar
//   DSH_HOME       defaults to %USERPROFILE%\.dsh
//   DSH_WORKSPACE  defaults to the current directory; {{ROOT}} expands to it
//   DSH_PROFILE    defaults to "probe"
//
// Usage: node run.cjs [--only c3_chain] [--profile probe] [--workspace DIR]
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};

const ROOT = path.resolve(opt('--workspace', process.env.DSH_WORKSPACE || process.cwd()));
const EXE = process.env.DSH_EXE || 'D:\\deep seek harness\\dsh\\DeepSeek Harness.exe';
const CLI = process.env.DSH_CLI || 'D:\\deep seek harness\\dsh\\resources\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js';
const HOME = process.env.DSH_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh');
const SESSIONS = path.join(HOME, 'sessions');
const profile = opt('--profile', process.env.EVAL_PROFILE || 'probe');
const only = opt('--only', '');

const expand = (s) => String(s).replace(/\{\{ROOT\}\}/g, ROOT);

function listSessions() {
  const out = new Set();
  try {
    for (const proj of fs.readdirSync(SESSIONS)) {
      const dir = path.join(SESSIONS, proj);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const s of fs.readdirSync(dir)) out.add(path.join(dir, s));
    }
  } catch {}
  return out;
}

function decodeLog(file) {
  const buf = fs.readFileSync(file);
  const out = [];
  let off = 0;
  while (off < buf.length) {
    let r;
    try { r = zlib.zstdDecompressSync(buf.subarray(off), { info: true }); } catch { break; }
    if (!r.engine || !r.engine.bytesWritten) break;
    out.push(r.buffer);
    off += r.engine.bytesWritten;
  }
  return Buffer.concat(out).toString('utf8').split('\n').filter(Boolean)
    .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

function stats(events) {
  const toolCalls = [];
  let steps = 0;
  let retries = 0;
  for (const e of events) {
    if (e.type === 'step/start') steps++;
    if (e.type === 'llm/retry') retries++;
    if (e.type === 'tool/call') toolCalls.push(e.data.name);
  }
  return { steps, toolCalls, toolCallCount: toolCalls.length, retries };
}

function countLines(p) {
  try { return fs.readFileSync(p, 'utf8').split(/\r?\n/).filter((l) => l.length > 0).length; } catch { return -1; }
}

function check(c, ctx) {
  switch (c.type) {
    case 'stdout_contains': return ctx.stdout.includes(expand(c.value));
    case 'stdout_no_digits': return !/[0-9]/.test(ctx.stdout);
    case 'tool_calls_max': return ctx.stats.toolCallCount <= c.value;
    case 'tool_calls_min': return ctx.stats.toolCallCount >= c.value;
    case 'file_lines': return countLines(expand(c.path)) === c.equals;
    default: return false;
  }
}

const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'));
const results = [];

for (const c of cases) {
  if (only && c.id !== only) continue;

  for (const f of c.setup || []) {
    const p = path.join(ROOT, f.path);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, f.content);
  }

  const before = listSessions();
  const started = Date.now();
  // Sanitize harness-injected env: when this runner is invoked from inside a
  // dsh session, DSH_PROFILE/DSH_PROFILE_DIR point at the caller's profile and
  // would be inherited by the child.
  const childEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
  for (const k of ['DSH_PROFILE', 'DSH_PROFILE_DIR', 'DSH_SESSION_ID', 'DSH_SHELL', 'DSH_WEB_URL']) delete childEnv[k];
  const run = spawnSync(EXE, ['--expose-internals', CLI, '--profile', profile, expand(c.prompt)], {
    cwd: ROOT,
    env: childEnv,
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 32 * 1024 * 1024,
  });
  const wallMs = Date.now() - started;

  const fresh = [...listSessions()].filter((x) => !before.has(x));
  let st = { steps: 0, toolCalls: [], toolCallCount: 0, retries: 0 };
  let sessionId = null;
  for (const dir of fresh) {
    const log = path.join(dir, 'session.v4.jsonl.zstd');
    if (fs.existsSync(log)) { sessionId = path.basename(dir); st = stats(decodeLog(log)); break; }
  }

  const stdout = (run.stdout || '').trim();
  const ctx = { stdout, stats: st };
  const failed = c.checks.filter((chk) => !check(chk, ctx));

  results.push({ id: c.id, name: c.name, pass: failed.length === 0, failed, sessionId,
    wallMs, exit: run.status, steps: st.steps, tools: st.toolCalls, retries: st.retries,
    stdout: stdout.slice(0, 400), stderr: (run.stderr || '').slice(0, 600) });
  if (run.status !== 0) console.log(`  stderr: ${(run.stderr || '').trim().slice(0, 300)}`);
  console.log(`${failed.length === 0 ? 'PASS' : 'FAIL'}  ${c.id.padEnd(14)} steps=${st.steps} tools=${st.toolCallCount} ${Math.round(wallMs / 1000)}s`);
}

const dir = path.join(__dirname, 'runs', new Date().toISOString().replace(/[:.]/g, '-'));
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(results, null, 2));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed  ->  ${dir}`);
