'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { main } = require('../lib/cli');

function fakeClient({ issues, forks, source }) {
  return {
    async whoami() { return 'fitzyracing1'; },
    async repoInfo() { return source; },
    async defaultSha() { return 'deadbeef'.repeat(5); },
    async fetchIssues() { return issues; },
    async fetchDiscussions() { return []; },
    async listViewerForks() { return forks; },
    async createFork() { throw new Error('should not create a fork in this test'); },
    async commitChecks() { return { checks: [], status: { statuses: [] } }; },
    run: async () => ({ status: 0, stdout: '', stderr: '' }),
  };
}

describe('cli classify-only', () => {
  it('writes a queue without building or pushing', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-cli-'));
    const issues = [
      {
        type: 'issue',
        number: 10,
        title: '[RFC] big design',
        body: 'ideas',
        url: 'https://example.com/10',
        labels: [{ name: 'Brainstorming' }],
        comments: [],
      },
      {
        type: 'issue',
        number: 11,
        title: 'build: CMake `-Werror=dev` option is deprecated',
        body: '`-Werror=dev` is deprecated. Use `-Werror=author` instead.',
        url: 'https://example.com/11',
        labels: [{ name: 'Build system' }],
        comments: [{ body: "it's a straightforward fix to the CI scripts and tests." }],
      },
    ];
    const doc = await main(['bitcoin/bitcoin', '--classify-only', '--out', dir], {
      client: fakeClient({
        issues,
        forks: [{ owner: 'fitzyracing1', name: 'viper', fullName: 'fitzyracing1/viper', parent: 'bitcoin/bitcoin', defaultBranch: 'master' }],
        source: { owner: 'bitcoin', name: 'bitcoin', fullName: 'bitcoin/bitcoin', defaultBranch: 'master' },
      }),
      now: () => '2026-11-16T19:00:00-05:00',
    });
    assert.equal(doc.items.length, 2);
    assert.equal(doc.items[0].buildable, false);
    assert.equal(doc.items[1].buildable, true);
    assert.equal(doc.items[1].built, false);
    assert.equal(doc.target, 'fitzyracing1/viper');
    assert.equal(fs.existsSync(path.join(dir, 'queue.md')), true);
    const md = fs.readFileSync(path.join(dir, 'queue.md'), 'utf8');
    assert.match(md, /never opens pull requests/);
    assert.doesNotMatch(md, /\*\*lit\*\*/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
