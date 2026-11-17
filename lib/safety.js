'use strict';

const ALWAYS_PROTECTED = new Set(['main', 'master']);

function normRepo(repo) {
  if (!repo) throw new Error('repository is required');
  if (typeof repo === 'string') {
    const parts = repo.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new Error(`invalid repo: ${repo}`);
    }
    return { owner: parts[0], name: parts[1], fullName: `${parts[0]}/${parts[1]}` };
  }
  const owner = repo.owner && (repo.owner.login || repo.owner);
  const name = repo.name;
  if (!owner || !name) throw new Error('invalid repo');
  return { owner, name, fullName: `${owner}/${name}` };
}

function sameRepo(a, b) {
  return normRepo(a).fullName.toLowerCase() === normRepo(b).fullName.toLowerCase();
}

function ownedBy(repo, login) {
  if (!login) throw new Error('runner login is required');
  return normRepo(repo).owner.toLowerCase() === String(login).toLowerCase();
}

function shortBranch(branch) {
  return String(branch || '').replace(/^refs\/heads\//, '');
}

function isProtectedBranch(branch, defaultBranch) {
  const b = shortBranch(branch).toLowerCase();
  if (!b) return true;
  if (ALWAYS_PROTECTED.has(b)) return true;
  if (defaultBranch && b === String(defaultBranch).toLowerCase()) return true;
  return false;
}

function assertRunnerOwns(repo, runner, action) {
  if (!ownedBy(repo, runner)) {
    throw new Error(
      `refusing to ${action} on ${normRepo(repo).fullName}: the runner (${runner}) does not own this repository`
    );
  }
}

function assertCanWriteTarget({ source, target, runner, targetIsForkOfSource }) {
  if (!target) throw new Error('write target is required');
  assertRunnerOwns(target, runner, 'write');
  const src = normRepo(source);
  const dst = normRepo(target);
  if (!sameRepo(src, dst) && !targetIsForkOfSource) {
    throw new Error(
      `refusing to write to ${dst.fullName}: it is not a fork of ${src.fullName} owned by ${runner}`
    );
  }
}

function assertSafeBranchName(branch, defaultBranch) {
  if (!branch || typeof branch !== 'string') throw new Error('branch is required');
  if (branch.startsWith('-')) throw new Error(`refusing branch name that looks like a flag: ${branch}`);
  if (branch.includes(':')) throw new Error(`refusing refspec-like branch name: ${branch}`);
  if (branch.includes('..') || branch.includes('@{')) throw new Error(`unsafe branch name: ${branch}`);
  if (/[\s~^?*\[\\]/.test(branch)) throw new Error(`unsafe branch name: ${branch}`);
  const short = shortBranch(branch);
  if (!short || short !== short.trim()) throw new Error(`invalid branch name: ${branch}`);
  if (isProtectedBranch(short, defaultBranch)) {
    throw new Error(`refusing to use default or protected branch ${short}`);
  }
  return short;
}

function pushArgv({ remote, branch, defaultBranch }) {
  if (!remote || typeof remote !== 'string' || remote.startsWith('-') || /[\s:]/.test(remote)) {
    throw new Error('invalid remote');
  }
  const b = assertSafeBranchName(branch, defaultBranch);
  return ['push', remote, `refs/heads/${b}:refs/heads/${b}`];
}

function assertSafeGitArgs(args) {
  const list = Array.isArray(args) ? args : [];
  for (const a of list) {
    if (a === '--force' || a === '-f' || a === '--force-with-lease' || a === '--force-if-includes') {
      throw new Error('refusing force-push');
    }
    if (typeof a === 'string' && a.startsWith('+')) {
      throw new Error('refusing forced refspec');
    }
  }
  return list;
}

const FORBIDDEN_ACTIONS = new Set([
  'create_pull_request',
  'open_pr',
  'comment',
  'issue_comment',
  'pr_comment',
  'review',
  'merge',
  'close_issue',
  'close_discussion',
]);

function assertAllowedAction(action, repo, runner) {
  if (FORBIDDEN_ACTIONS.has(action)) {
    throw new Error(
      `refusing to ${action}: discuss-build never opens PRs, comments, or merges; a human decides what goes upstream`
    );
  }
  if (['push', 'create_branch', 'create_fork'].includes(action)) {
    if (action !== 'create_fork') assertRunnerOwns(repo, runner, action);
  }
}

function slugify(title, max = 40) {
  const slug = String(title || '')
    .toLowerCase()
    .replace(/[`'"“”‘’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
  return slug || 'item';
}

function branchNameFor(item) {
  const kind = item.type === 'discussion' ? 'disc' : 'issue';
  return `discuss-build/${kind}-${item.number}-${slugify(item.title)}`;
}

module.exports = {
  ALWAYS_PROTECTED,
  FORBIDDEN_ACTIONS,
  normRepo,
  sameRepo,
  ownedBy,
  shortBranch,
  isProtectedBranch,
  assertRunnerOwns,
  assertCanWriteTarget,
  assertSafeBranchName,
  pushArgv,
  assertSafeGitArgs,
  assertAllowedAction,
  slugify,
  branchNameFor,
};
