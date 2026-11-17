'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { createBuildBranch, commitAll, createGit } = require('../lib/git');

function exec(command, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdin.end();
    child.on('error', reject);
    child.on('close', (status) => resolve({ status: status ?? 1, stdout, stderr }));
  });
}

describe('createBuildBranch', () => {
  it('starts each new branch from the upstream tip, not the previous build', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-git-'));
    const git = createGit({ exec, cwd: dir }).git;
    await git(['init', '-b', 'master']);
    fs.writeFileSync(path.join(dir, 'README.md'), 'base\n');
    await git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', 'README.md']);
    await git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'base']);
    const base = await git(['rev-parse', 'HEAD']);

    await createBuildBranch({ exec, workDir: dir, branch: 'discuss-build/issue-1-one', defaultBranch: 'master', baseRef: base });
    fs.writeFileSync(path.join(dir, 'one.txt'), 'one\n');
    await commitAll({ exec, workDir: dir, message: 'one', name: 't', email: 't@t' });

    await createBuildBranch({ exec, workDir: dir, branch: 'discuss-build/issue-2-two', defaultBranch: 'master', baseRef: base });
    fs.writeFileSync(path.join(dir, 'two.txt'), 'two\n');
    const sha = await commitAll({ exec, workDir: dir, message: 'two', name: 't', email: 't@t' });
    assert.ok(sha);
    const files = await git(['show', '--pretty=', '--name-only', sha]);
    assert.equal(files.trim(), 'two.txt');
    assert.equal(fs.existsSync(path.join(dir, 'one.txt')), false);
    // also refuse starting on master
    await assert.rejects(
      () => createBuildBranch({ exec, workDir: dir, branch: 'master', defaultBranch: 'master', baseRef: base }),
      /protected/
    );
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
