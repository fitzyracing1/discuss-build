'use strict';
const fs = require('fs');
const path = require('path');

function walkFiles(root, { maxFiles = 4000 } = {}) {
  const out = [];
  const skip = new Set(['.git', 'node_modules', 'out', 'work', '.venv', 'build']);
  function walk(dir) {
    if (out.length >= maxFiles) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      if (skip.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) out.push(p);
    }
  }
  walk(root);
  return out;
}

function readIfText(file, maxBytes = 1024 * 1024) {
  const st = fs.statSync(file);
  if (st.size > maxBytes) return null;
  const buf = fs.readFileSync(file);
  if (buf.includes(0)) return null;
  return buf.toString('utf8');
}

function extractUnifiedDiff(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:diff|patch)?\n([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  if (/^diff --git /m.test(candidate) || /^(--- |\+\+\+ |@@ )/m.test(candidate)) {
    const lines = candidate.split('\n');
    const start = lines.findIndex((l) => l.startsWith('diff --git ') || l.startsWith('--- '));
    if (start === -1) return null;
    const body = lines.slice(start).join('\n').trim();
    if (!/^@@ /m.test(body) && !/^diff --git /m.test(body)) return null;
    return body.endsWith('\n') ? body : body + '\n';
  }
  return null;
}

function commentsBlockPlainSwap(comments) {
  const c = String(comments || '');
  return /plain swap isn't safe|plain swap is not safe|silently ignored|choose the flag by cmake version|not safe to (simply )?replace/i.test(c);
}

function extractExactReplacement(item) {
  const text = `${item.title || ''}\n${item.body || ''}\n${(item.comments || []).map((c) => c.body || c).join('\n')}`;
  if (commentsBlockPlainSwap(text)) return null;
  const patterns = [
    /use\s+`([^`]+)`\s+instead(?:\s+of\s+`([^`]+)`)?/i,
    /replace\s+`([^`]+)`\s+(?:with|by)\s+`([^`]+)`/i,
    /change\s+`([^`]+)`\s+to\s+`([^`]+)`/i,
    /`([^`]+)`\s+is deprecated\.?\s+use\s+`([^`]+)`\s+instead/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m) continue;
    if (m[2]) return { from: m[1], to: m[2] };
    // "use X instead" — try to find the deprecated token nearby
    const dep = text.match(/`([^`]+)`\s+is(?: now)? deprecated/i);
    if (dep && dep[1] !== m[1]) return { from: dep[1], to: m[1] };
  }
  return null;
}

function applyExactReplacement(root, from, to, { maxHits = 20 } = {}) {
  if (!from || !to || from === to) return { applied: false, reason: 'replacement is empty or a no-op' };
  if (from.length < 3 || to.length < 3) return { applied: false, reason: 'replacement tokens are too short to apply safely' };
  const files = walkFiles(root);
  const hits = [];
  for (const file of files) {
    const text = readIfText(file);
    if (text == null) continue;
    if (!text.includes(from)) continue;
    const count = text.split(from).length - 1;
    hits.push({ file, count });
  }
  const total = hits.reduce((n, h) => n + h.count, 0);
  if (total === 0) return { applied: false, reason: `did not find ${JSON.stringify(from)} in the tree` };
  if (total > maxHits) {
    return { applied: false, reason: `refusing to replace ${JSON.stringify(from)}: it occurs ${total} times` };
  }
  const changed = [];
  for (const h of hits) {
    const text = fs.readFileSync(h.file, 'utf8');
    fs.writeFileSync(h.file, text.split(from).join(to));
    changed.push(path.relative(root, h.file));
  }
  return { applied: true, reason: `replaced ${JSON.stringify(from)} with ${JSON.stringify(to)} in ${changed.join(', ')}`, files: changed, strategy: 'exact-replace' };
}

function findPatchFile(patchDir, number) {
  if (!patchDir) return null;
  const names = [`${number}.patch`, `${number}.diff`, `issue-${number}.patch`, `issue-${number}.diff`];
  for (const n of names) {
    const p = path.join(patchDir, n);
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

async function applyPatchFile(exec, workDir, patchFile) {
  const result = await exec('git', ['apply', '--whitespace=nowarn', patchFile], { cwd: workDir });
  if (result.status !== 0) {
    const fallback = await exec('git', ['apply', '--3way', '--whitespace=nowarn', patchFile], { cwd: workDir });
    if (fallback.status !== 0) {
      throw new Error((fallback.stderr || result.stderr || 'git apply failed').trim());
    }
  }
  return { applied: true, reason: `applied patch ${path.basename(patchFile)}`, strategy: 'patch-file', files: [path.basename(patchFile)] };
}

async function applyIssueDiff(exec, workDir, diff) {
  const tmp = path.join(workDir, '.discuss-build-issue.patch');
  fs.writeFileSync(tmp, diff);
  try {
    return await applyPatchFile(exec, workDir, tmp);
  } finally {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

async function attemptBuild({ item, workDir, patchDir, exec, log = () => {} }) {
  const patchFile = findPatchFile(patchDir, item.number);
  if (patchFile) {
    log(`applying ${patchFile}`);
    const r = await applyPatchFile(exec, workDir, patchFile);
    return { ...r, reason: `applied a subscriber-supplied patch (${path.basename(patchFile)})` };
  }

  const diff = extractUnifiedDiff(item.body || '');
  if (diff) {
    log('applying unified diff from the issue body');
    try {
      const r = await applyIssueDiff(exec, workDir, diff);
      return { ...r, reason: 'applied the unified diff included in the issue body', strategy: 'issue-diff' };
    } catch (err) {
      return { applied: false, reason: `the issue contains a diff, but it did not apply: ${err.message}` };
    }
  }

  const comments = (item.comments || []).map((c) => c.body || c).join('\n');
  if (commentsBlockPlainSwap(`${item.body}\n${comments}`)) {
    return {
      applied: false,
      reason: 'a plain token swap is not safe here (comments describe a version- or context-specific fix), and no patch file was supplied',
    };
  }

  const repl = extractExactReplacement(item);
  if (repl) {
    const r = applyExactReplacement(workDir, repl.from, repl.to);
    if (r.applied) return r;
    return r;
  }

  return {
    applied: false,
    reason: 'no automatic patch could be derived; supply a file in --patch-dir or include a unified diff in the issue',
  };
}

function commitMessage(sourceFullName, item) {
  const kind = item.type === 'discussion' ? 'discussion' : 'issue';
  const title = String(item.title || 'change').replace(/\s+/g, ' ').trim().slice(0, 72);
  return [
    `discuss-build: ${title}`,
    '',
    `Build the concrete ask from ${sourceFullName}#${item.number} (${kind}).`,
    'This branch is on the subscriber fork only and is not an upstream pull request.',
  ].join('\n');
}

module.exports = {
  walkFiles,
  extractUnifiedDiff,
  extractExactReplacement,
  commentsBlockPlainSwap,
  applyExactReplacement,
  findPatchFile,
  attemptBuild,
  commitMessage,
};
