'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { renderMarkdown, writeReports, emptyDoc } = require('../lib/report');

describe('report', () => {
  const doc = emptyDoc({
    source: 'bitcoin/bitcoin',
    target: 'fitzyracing1/viper',
    targetReason: 'the runner already has a fork, fitzyracing1/viper (the fork was renamed)',
    runner: 'fitzyracing1',
    sourceDefault: 'master',
    sourceSha: 'abc123',
    generatedAt: '2026-11-16T19:00:00-05:00',
    items: [
      {
        item: { type: 'issue', number: 36657, title: 'Clarify ipcbind', url: 'https://github.com/bitcoin/bitcoin/issues/36657' },
        buildable: true,
        scope: 'small',
        reason: 'small change',
        built: true,
        branch: 'discuss-build/issue-36657-clarify-ipcbind',
        ciStatus: 'lit',
        ciSummary: 'local syntax checks passed',
        buildNotes: 'applied a patch — local syntax checks passed',
      },
      {
        item: { type: 'issue', number: 1, title: 'RFC idea', url: 'https://github.com/bitcoin/bitcoin/issues/1' },
        buildable: false,
        reason: 'This is labeled or titled as an RFC, brainstorming, tracking, or conceptual-review item, not a single concrete change.',
      },
      {
        item: { type: 'issue', number: 2, title: 'Bigger fix', url: 'https://github.com/bitcoin/bitcoin/issues/2' },
        buildable: true,
        scope: 'medium',
        reason: 'concrete but larger',
        skipReason: 'Skipped because the scope is larger than the small automatic-build cap.',
      },
    ],
    limits: ['No pull requests or comments were opened, including on the source repository.'],
  });

  it('writes markdown that states the human-OK rule and lit/dark results', () => {
    const md = renderMarkdown(doc);
    assert.match(md, /queue for bitcoin\/bitcoin/);
    assert.match(md, /fitzyracing1\/viper/);
    assert.match(md, /never opens pull requests/);
    assert.match(md, /A human decides/);
    assert.match(md, /\*\*lit\*\*/);
    assert.match(md, /Clarify ipcbind/);
    assert.match(md, /RFC idea/);
    assert.match(md, /larger than the small automatic-build cap/);
  });

  it('writes both queue.md and queue.json', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-out-'));
    const { jsonPath, mdPath } = writeReports(dir, doc);
    assert.equal(fs.existsSync(jsonPath), true);
    assert.equal(fs.existsSync(mdPath), true);
    const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    assert.equal(parsed.source, 'bitcoin/bitcoin');
    assert.equal(parsed.items.length, 3);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
