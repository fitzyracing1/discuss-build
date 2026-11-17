'use strict';
const fs = require('fs');
const path = require('path');

function itemRef(item) {
  const kind = item.type === 'discussion' ? 'discussion' : 'issue';
  return `${kind} #${item.number}`;
}

function renderMarkdown(doc) {
  const lines = [];
  lines.push(`# discuss-build queue for ${doc.source}`);
  lines.push('');
  lines.push(`- Runner: \`${doc.runner}\``);
  lines.push(`- Write target: \`${doc.target || '(none)'}\`${doc.targetReason ? ` — ${doc.targetReason}` : ''}`);
  if (doc.sourceDefault) lines.push(`- Source default: \`${doc.sourceDefault}\`${doc.sourceSha ? ` @ ${doc.sourceSha}` : ''}`);
  lines.push(`- Generated: ${doc.generatedAt}`);
  if (doc.dryRun) lines.push('- Mode: dry-run (no pushes)');
  if (doc.classifyOnly) lines.push('- Mode: classify-only (no builds)');
  lines.push('');
  lines.push('Nothing in this queue is opened upstream. discuss-build never opens pull requests, never comments, and never pushes to a repository the runner does not own. A human decides which, if any, of these branches become a pull request.');
  lines.push('');

  const built = doc.items.filter((i) => i.built);
  const buildableSkipped = doc.items.filter((i) => i.buildable && !i.built);
  const notBuildable = doc.items.filter((i) => !i.buildable);

  lines.push('## Built');
  if (!built.length) lines.push('None.');
  else {
    lines.push('| Item | Branch | Result | Notes |');
    lines.push('| --- | --- | --- | --- |');
    for (const i of built) {
      const result = i.ciStatus || 'untested';
      lines.push(`| [${itemRef(i.item)}](${i.item.url}) ${escapeTable(i.item.title)} | \`${i.branch || ''}\` | **${result}** | ${escapeTable(i.buildNotes || i.ciSummary || '')} |`);
    }
  }
  lines.push('');
  lines.push('## Buildable, not built');
  if (!buildableSkipped.length) lines.push('None.');
  else {
    lines.push('| Item | Scope | Reason |');
    lines.push('| --- | --- | --- |');
    for (const i of buildableSkipped) {
      lines.push(`| [${itemRef(i.item)}](${i.item.url}) ${escapeTable(i.item.title)} | ${i.scope || ''} | ${escapeTable(i.skipReason || i.reason)} |`);
    }
  }
  lines.push('');
  lines.push('## Not buildable');
  if (!notBuildable.length) lines.push('None.');
  else {
    lines.push('| Item | Reason |');
    lines.push('| --- | --- | --- |');
    for (const i of notBuildable) {
      lines.push(`| [${itemRef(i.item)}](${i.item.url}) ${escapeTable(i.item.title)} | ${escapeTable(i.reason)} |`);
    }
  }
  lines.push('');
  lines.push('## Counts');
  lines.push(`Fetched ${doc.items.length}. Buildable: ${doc.items.filter((i) => i.buildable).length}. Built: ${built.length}. Lit: ${built.filter((i) => i.ciStatus === 'lit').length}. Dark: ${built.filter((i) => i.ciStatus === 'dark').length}. Untested: ${built.filter((i) => i.ciStatus === 'untested').length}.`);
  lines.push('');
  if (doc.limits && doc.limits.length) {
    lines.push('## Limits');
    for (const lim of doc.limits) lines.push(`- ${lim}`);
    lines.push('');
  }
  return lines.join('\n');
}

function escapeTable(s) {
  return String(s || '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function writeReports(outDir, doc) {
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'queue.json');
  const mdPath = path.join(outDir, 'queue.md');
  fs.writeFileSync(jsonPath, JSON.stringify(doc, null, 2) + '\n');
  fs.writeFileSync(mdPath, renderMarkdown(doc));
  return { jsonPath, mdPath };
}

function emptyDoc(partial) {
  return {
    source: partial.source,
    target: partial.target || null,
    targetReason: partial.targetReason || '',
    runner: partial.runner,
    sourceDefault: partial.sourceDefault || '',
    sourceSha: partial.sourceSha || '',
    generatedAt: partial.generatedAt || new Date().toISOString(),
    dryRun: Boolean(partial.dryRun),
    classifyOnly: Boolean(partial.classifyOnly),
    items: partial.items || [],
    limits: partial.limits || [],
  };
}

module.exports = { renderMarkdown, writeReports, emptyDoc, escapeTable, itemRef };
