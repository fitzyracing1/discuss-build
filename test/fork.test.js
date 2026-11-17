'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { resolveWriteTarget } = require('../lib/fork');

function clientWith({ source, forks, created = null }) {
  return {
    async repoInfo(name) {
      if (source && name.toLowerCase() === (source.requested || source.fullName).toLowerCase()) return source;
      const hit = forks.find((f) => f.fullName.toLowerCase() === name.toLowerCase());
      if (hit) return { ...hit, isFork: true };
      throw new Error('not found: ' + name);
    },
    async listViewerForks(login) {
      return forks.filter((f) => f.owner === login);
    },
    async createFork() {
      return created;
    },
  };
}

describe('resolveWriteTarget', () => {
  it('writes on the source when the runner owns it', async () => {
    const source = { owner: 'fitzyracing1', name: 'tools', fullName: 'fitzyracing1/tools', defaultBranch: 'main', requested: 'fitzyracing1/tools' };
    const r = await resolveWriteTarget({
      client: clientWith({ source, forks: [] }),
      source: 'fitzyracing1/tools',
      runner: 'fitzyracing1',
    });
    assert.equal(r.target.fullName, 'fitzyracing1/tools');
    assert.match(r.reason, /owns the source/);
  });

  it('discovers a renamed fork of a foreign source', async () => {
    const source = { owner: 'bitcoin', name: 'bitcoin', fullName: 'bitcoin/bitcoin', defaultBranch: 'master', requested: 'bitcoin/bitcoin' };
    const fork = { owner: 'fitzyracing1', name: 'viper', fullName: 'fitzyracing1/viper', parent: 'bitcoin/bitcoin', defaultBranch: 'master' };
    const r = await resolveWriteTarget({
      client: clientWith({ source, forks: [fork] }),
      source: 'bitcoin/bitcoin',
      runner: 'fitzyracing1',
    });
    assert.equal(r.target.fullName, 'fitzyracing1/viper');
    assert.match(r.reason, /renamed/);
  });

  it('does not create a fork on dry-run', async () => {
    const source = { owner: 'bitcoin', name: 'bitcoin', fullName: 'bitcoin/bitcoin', defaultBranch: 'master', requested: 'bitcoin/bitcoin' };
    const r = await resolveWriteTarget({
      client: clientWith({ source, forks: [] }),
      source: 'bitcoin/bitcoin',
      runner: 'fitzyracing1',
      dryRun: true,
    });
    assert.equal(r.target, null);
    assert.match(r.reason, /would create/);
  });

  it('refuses a --fork that the runner does not own', async () => {
    const source = { owner: 'bitcoin', name: 'bitcoin', fullName: 'bitcoin/bitcoin', defaultBranch: 'master', requested: 'bitcoin/bitcoin' };
    await assert.rejects(
      () =>
        resolveWriteTarget({
          client: clientWith({
            source,
            forks: [{ owner: 'someone', name: 'bitcoin', fullName: 'someone/bitcoin', parent: 'bitcoin/bitcoin', defaultBranch: 'master' }],
          }),
          source: 'bitcoin/bitcoin',
          runner: 'fitzyracing1',
          forkOverride: 'someone/bitcoin',
        }),
      /does not own/
    );
  });
});
