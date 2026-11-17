'use strict';
const fs = require('fs');
const path = require('path');

function cheapChecksFor(files) {
  const checks = [];
  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const base = path.basename(file);
    if (ext === '.sh' || /\.(bash|zsh)$/i.test(base) || base.endsWith('.sh')) {
      checks.push({ kind: 'bash-n', file, argv: ['bash', ['-n', file]] });
    } else if (ext === '.py') {
      checks.push({ kind: 'py-compile', file, argv: ['python3', ['-m', 'py_compile', file]] });
    } else if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
      checks.push({ kind: 'node-check', file, argv: ['node', ['--check', file]] });
    }
  }
  return checks;
}

function changedFilesFromStatus(porcelain) {
  return String(porcelain || '')
    .split('\n')
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

async function runCheapLocalTests({ exec, workDir, files, log = () => {} }) {
  const checks = cheapChecksFor(files.map((f) => path.isAbsolute(f) ? f : path.join(workDir, f)));
  if (!checks.length) {
    return { status: 'untested', summary: 'no cheap local syntax checks apply to the changed files', results: [] };
  }
  const results = [];
  for (const c of checks) {
    log(`local check ${c.kind} ${path.relative(workDir, c.file)}`);
    const result = await exec(c.argv[0], c.argv[1], { cwd: workDir });
    const ok = result.status === 0;
    results.push({
      kind: c.kind,
      file: path.relative(workDir, c.file),
      ok,
      output: ((result.stderr || result.stdout || '').trim()).slice(0, 2000),
    });
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    return { status: 'dark', summary: `local checks failed: ${failed.map((f) => f.file).join(', ')}`, results };
  }
  return { status: 'lit', summary: `local syntax checks passed on ${results.length} file(s)`, results };
}

function summarizeChecks({ checks, status }) {
  const runs = checks || [];
  const combined = [];
  for (const c of runs) {
    const state = (c.conclusion || c.status || '').toLowerCase();
    combined.push({ name: c.name, state, source: 'check-run' });
  }
  const st = status || {};
  if (Array.isArray(st.statuses)) {
    for (const s of st.statuses) {
      combined.push({ name: s.context || s.description, state: (s.state || '').toLowerCase(), source: 'status' });
    }
  }
  const meaningful = combined.filter((c) => c.state && c.state !== 'neutral' && c.state !== 'skipped');
  const pending = meaningful.filter((c) => ['queued', 'in_progress', 'pending', 'expected'].includes(c.state));
  const failed = meaningful.filter((c) => ['failure', 'failed', 'error', 'cancelled', 'timed_out', 'action_required'].includes(c.state));
  const passed = meaningful.filter((c) => ['success', 'completed'].includes(c.state) || (c.state === 'completed' /* check-run uses conclusion */));
  // check-run "status" can be completed with conclusion success — already mapped via conclusion first.
  const ok = meaningful.filter((c) => c.state === 'success');
  return { all: combined, pending, failed, passed: ok, hasAny: meaningful.length > 0 };
}

async function waitForCi({ client, fullName, sha, waitSeconds, pollMs = 10000, log = () => {} }) {
  const deadline = Date.now() + waitSeconds * 1000;
  let last = { all: [], pending: [], failed: [], passed: [], hasAny: false };
  let sawAnything = false;
  while (Date.now() <= deadline) {
    const raw = await client.commitChecks(fullName, sha);
    last = summarizeChecks(raw);
    if (last.hasAny) sawAnything = true;
    if (last.failed.length) {
      return { status: 'dark', summary: `fork CI failed: ${last.failed.map((f) => f.name).join(', ')}`, checks: last };
    }
    if (sawAnything && last.pending.length === 0 && last.passed.length > 0) {
      return { status: 'lit', summary: `fork CI passed (${last.passed.length} check(s))`, checks: last };
    }
    const left = Math.max(0, deadline - Date.now());
    if (left === 0) break;
    log(`waiting for CI on ${sha.slice(0, 7)} (${last.pending.length || 0} pending)`);
    await new Promise((r) => setTimeout(r, Math.min(pollMs, left)));
  }
  if (!sawAnything) {
    return { status: 'untested', summary: 'no fork CI checks appeared before the wait timed out', checks: last };
  }
  if (last.pending.length) {
    return { status: 'untested', summary: `fork CI was still running after ${waitSeconds}s`, checks: last };
  }
  return { status: 'untested', summary: 'fork CI did not finish with a clear pass or fail', checks: last };
}

function combineResults(ci, local) {
  // Prefer real CI when it decided; otherwise report local honestly.
  if (ci && (ci.status === 'lit' || ci.status === 'dark')) {
    return { status: ci.status, summary: ci.summary, ci, local: local || null };
  }
  if (local && (local.status === 'lit' || local.status === 'dark')) {
    const prefix = ci && ci.status === 'untested' ? `${ci.summary}; ` : '';
    return { status: local.status, summary: prefix + local.summary, ci: ci || null, local };
  }
  const bits = [ci && ci.summary, local && local.summary].filter(Boolean);
  return { status: 'untested', summary: bits.join('; ') || 'no CI or local tests were available', ci: ci || null, local: local || null };
}

function packageTestExists(workDir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(workDir, 'package.json'), 'utf8'));
    return Boolean(pkg.scripts && pkg.scripts.test);
  } catch {
    return false;
  }
}

module.exports = {
  cheapChecksFor,
  changedFilesFromStatus,
  runCheapLocalTests,
  summarizeChecks,
  waitForCi,
  combineResults,
  packageTestExists,
};
