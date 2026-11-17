'use strict';
const fs = require('fs');
const path = require('path');
const { pushArgv, assertSafeGitArgs, assertSafeBranchName } = require('./safety');

function createGit({ exec, cwd }) {
  async function git(args, opts = {}) {
    const safe = assertSafeGitArgs(args);
    const result = await exec('git', safe, { cwd: opts.cwd || cwd, env: opts.env });
    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout || 'git failed').trim());
    }
    return (result.stdout || '').trim();
  }
  return { git, cwd };
}

async function ensureWorktree({ exec, workDir, sourceUrl, sourceBranch, log = () => {} }) {
  fs.mkdirSync(path.dirname(workDir), { recursive: true });
  if (!fs.existsSync(path.join(workDir, '.git'))) {
    if (fs.existsSync(workDir)) fs.rmSync(workDir, { recursive: true, force: true });
    log(`cloning ${sourceUrl} (${sourceBranch}, shallow)`);
    const result = await exec('git', [
      'clone', '--depth', '1', '--branch', sourceBranch,
      sourceUrl, workDir,
    ], {});
    if (result.status !== 0) {
      throw new Error((result.stderr || result.stdout || 'git clone failed').trim());
    }
  } else {
    const git = createGit({ exec, cwd: workDir }).git;
    await git(['fetch', '--depth', '1', 'origin', sourceBranch]);
    // Do not reset any local default-branch checkout if one exists; always move to a detached origin tip first.
    await git(['checkout', '--detach', `origin/${sourceBranch}`]);
  }
  return workDir;
}

async function createBuildBranch({ exec, workDir, branch, defaultBranch, baseRef, log = () => {} }) {
  const name = assertSafeBranchName(branch, defaultBranch);
  if (!baseRef || String(baseRef).startsWith('-') || String(baseRef).includes(':')) {
    throw new Error('a safe upstream base ref is required');
  }
  const git = createGit({ exec, cwd: workDir }).git;
  // Always start from the upstream tip, never from a previous build branch.
  await git(['checkout', '--detach', String(baseRef)]);
  try {
    await git(['rev-parse', '--verify', name]);
    await git(['branch', '-D', name]);
  } catch {
    // no local branch, fine
  }
  await git(['checkout', '-b', name]);
  log(`created branch ${name}`);
  return name;
}

async function commitAll({ exec, workDir, message, name = 'Joshua Almeida', email = 'fitzyracing1@users.noreply.github.com' }) {
  const git = createGit({ exec, cwd: workDir }).git;
  await git(['add', '-A']);
  const status = await git(['status', '--porcelain']);
  if (!status) return null;
  await git(['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '-m', message]);
  const sha = await git(['rev-parse', 'HEAD']);
  return sha;
}

async function pushBranch({ exec, workDir, remoteUrl, branch, defaultBranch, remoteName = 'discuss-build-fork', log = () => {} }) {
  const name = assertSafeBranchName(branch, defaultBranch);
  const git = createGit({ exec, cwd: workDir }).git;
  const remotes = (await git(['remote'])).split(/\n/).filter(Boolean);
  if (remotes.includes(remoteName)) {
    await git(['remote', 'set-url', remoteName, remoteUrl]);
  } else {
    await git(['remote', 'add', remoteName, remoteUrl]);
  }
  const args = pushArgv({ remote: remoteName, branch: name, defaultBranch });
  log(`pushing ${name} to ${remoteUrl}`);
  await git(args);
  const sha = await git(['rev-parse', 'HEAD']);
  return sha;
}

function githubHttps(fullName) {
  return `https://github.com/${fullName}.git`;
}

module.exports = {
  createGit,
  ensureWorktree,
  createBuildBranch,
  commitAll,
  pushBranch,
  githubHttps,
};
