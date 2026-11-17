'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  normRepo,
  ownedBy,
  sameRepo,
  isProtectedBranch,
  assertRunnerOwns,
  assertCanWriteTarget,
  assertSafeBranchName,
  pushArgv,
  assertSafeGitArgs,
  assertAllowedAction,
  branchNameFor,
} = require('../lib/safety');

describe('safety', () => {
  it('parses owner/repo and rejects junk', () => {
    assert.deepEqual(normRepo('bitcoin/bitcoin'), { owner: 'bitcoin', name: 'bitcoin', fullName: 'bitcoin/bitcoin' });
    assert.equal(ownedBy('fitzyracing1/viper', 'fitzyracing1'), true);
    assert.equal(ownedBy('bitcoin/bitcoin', 'fitzyracing1'), false);
    assert.equal(sameRepo('Bitcoin/Bitcoin', { owner: 'bitcoin', name: 'bitcoin' }), true);
    assert.throws(() => normRepo('noslash'), /invalid repo/);
  });

  it('protects default and main/master branches', () => {
    assert.equal(isProtectedBranch('master', 'master'), true);
    assert.equal(isProtectedBranch('main', 'develop'), true);
    assert.equal(isProtectedBranch('discuss-build/issue-1-typo', 'master'), false);
    assert.equal(isProtectedBranch('refs/heads/master', 'master'), true);
    assert.throws(() => assertSafeBranchName('master', 'master'), /protected/);
    assert.throws(() => assertSafeBranchName('main', 'develop'), /protected/);
    assert.throws(() => assertSafeBranchName('feature:master', 'master'), /refspec/);
    assert.throws(() => assertSafeBranchName('-u', 'master'), /flag/);
    assert.equal(assertSafeBranchName('discuss-build/issue-9-floor', 'master'), 'discuss-build/issue-9-floor');
  });

  it('refuses writes on repositories the runner does not own', () => {
    assert.throws(
      () => assertRunnerOwns('bitcoin/bitcoin', 'fitzyracing1', 'push'),
      /does not own/
    );
    assert.doesNotThrow(() =>
      assertCanWriteTarget({
        source: 'bitcoin/bitcoin',
        target: 'fitzyracing1/viper',
        runner: 'fitzyracing1',
        targetIsForkOfSource: true,
      })
    );
    assert.throws(
      () =>
        assertCanWriteTarget({
          source: 'bitcoin/bitcoin',
          target: 'someone/bitcoin',
          runner: 'fitzyracing1',
          targetIsForkOfSource: true,
        }),
      /does not own/
    );
    assert.throws(
      () =>
        assertCanWriteTarget({
          source: 'bitcoin/bitcoin',
          target: 'fitzyracing1/unrelated',
          runner: 'fitzyracing1',
          targetIsForkOfSource: false,
        }),
      /not a fork/
    );
  });

  it('builds a non-force push of only the named branch', () => {
    const args = pushArgv({ remote: 'fork', branch: 'discuss-build/issue-1-docs', defaultBranch: 'master' });
    assert.deepEqual(args, ['push', 'fork', 'refs/heads/discuss-build/issue-1-docs:refs/heads/discuss-build/issue-1-docs']);
    assert.ok(!args.some((a) => a === '--force' || String(a).startsWith('+')));
    assert.throws(() => pushArgv({ remote: 'fork', branch: 'master', defaultBranch: 'master' }), /protected/);
    assert.throws(() => pushArgv({ remote: '-u', branch: 'discuss-build/x', defaultBranch: 'master' }), /invalid remote/);
  });

  it('rejects force flags and upstream side effects', () => {
    assert.throws(() => assertSafeGitArgs(['push', '--force', 'fork', 'branch']), /force-push/);
    assert.throws(() => assertSafeGitArgs(['push', 'fork', '+refs/heads/x:refs/heads/x']), /forced refspec/);
    assert.deepEqual(assertSafeGitArgs(['push', 'fork', 'refs/heads/x:refs/heads/x']), ['push', 'fork', 'refs/heads/x:refs/heads/x']);
    assert.throws(() => assertAllowedAction('create_pull_request', 'fitzyracing1/viper', 'fitzyracing1'), /never opens PRs/);
    assert.throws(() => assertAllowedAction('comment', 'bitcoin/bitcoin', 'fitzyracing1'), /never opens PRs/);
    assert.throws(() => assertAllowedAction('push', 'bitcoin/bitcoin', 'fitzyracing1'), /does not own/);
    assert.doesNotThrow(() => assertAllowedAction('push', 'fitzyracing1/viper', 'fitzyracing1'));
  });

  it('names branches from items without hitting protected refs', () => {
    const name = branchNameFor({ type: 'issue', number: 36657, title: 'Clarify -ipcbind syntax when using max-connections' });
    assert.match(name, /^discuss-build\/issue-36657-clarify-ipcbind-/);
    assert.ok(name.length <= 80);
    assert.ok(!name.includes(':'));
    assert.ok(name.startsWith('discuss-build/'));
  });
});
