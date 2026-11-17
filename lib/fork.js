'use strict';
const { normRepo, sameRepo, ownedBy, assertCanWriteTarget } = require('./safety');

async function findForkOf(client, source, runner) {
  const src = normRepo(source);
  const forks = await client.listViewerForks(runner);
  return forks.find((f) => f.parent && f.parent.toLowerCase() === src.fullName.toLowerCase()) || null;
}

async function resolveWriteTarget({ client, source, runner, forkOverride, createFork, dryRun, log = () => {} }) {
  const src = typeof source === 'string' ? await client.repoInfo(source) : source;
  const sourceRepo = {
    owner: src.owner,
    name: src.name,
    fullName: src.fullName || `${src.owner}/${src.name}`,
    defaultBranch: src.defaultBranch,
    isFork: src.isFork,
    parent: src.parent || null,
  };

  if (forkOverride) {
    const info = await client.repoInfo(forkOverride);
    const isSelf = sameRepo(info.fullName, sourceRepo.fullName);
    const isFork = info.parent && info.parent.toLowerCase() === sourceRepo.fullName.toLowerCase();
    assertCanWriteTarget({
      source: sourceRepo,
      target: info,
      runner,
      targetIsForkOfSource: isSelf || isFork,
    });
    return {
      source: sourceRepo,
      target: { ...info, defaultBranch: info.defaultBranch },
      created: false,
      reason: isSelf ? 'write target is the source repository, which the runner owns' : 'write target is the runner-owned fork given by --fork',
    };
  }

  if (ownedBy(sourceRepo, runner)) {
    assertCanWriteTarget({ source: sourceRepo, target: sourceRepo, runner, targetIsForkOfSource: true });
    return {
      source: sourceRepo,
      target: sourceRepo,
      created: false,
      reason: 'the runner owns the source repository; branches will be created on it, not on the default branch',
    };
  }

  const existing = await findForkOf(client, sourceRepo, runner);
  if (existing) {
    assertCanWriteTarget({ source: sourceRepo, target: existing, runner, targetIsForkOfSource: true });
    log(`using existing fork ${existing.fullName} (source ${sourceRepo.fullName})`);
    return {
      source: sourceRepo,
      target: existing,
      created: false,
      reason: `the runner already has a fork, ${existing.fullName}` + (existing.name.toLowerCase() !== sourceRepo.name.toLowerCase() ? ' (the fork was renamed)' : ''),
    };
  }

  if (dryRun) {
    return {
      source: sourceRepo,
      target: null,
      created: false,
      reason: `no fork of ${sourceRepo.fullName} is owned by ${runner}; would create one if --create-fork were set`,
    };
  }

  if (!createFork) {
    throw new Error(
      `no fork of ${sourceRepo.fullName} owned by ${runner}. Re-run with --create-fork to create one, or pass --fork owner/repo.`
    );
  }

  log(`creating fork of ${sourceRepo.fullName} for ${runner}`);
  await client.createFork(sourceRepo.fullName);
  const created = await findForkOf(client, sourceRepo, runner);
  if (!created) {
    // Immediately after fork, the listing can lag; assume the default name.
    const guessed = { owner: runner, name: sourceRepo.name, fullName: `${runner}/${sourceRepo.name}`, parent: sourceRepo.fullName, defaultBranch: sourceRepo.defaultBranch };
    assertCanWriteTarget({ source: sourceRepo, target: guessed, runner, targetIsForkOfSource: true });
    return { source: sourceRepo, target: guessed, created: true, reason: 'created a new fork owned by the runner' };
  }
  assertCanWriteTarget({ source: sourceRepo, target: created, runner, targetIsForkOfSource: true });
  return { source: sourceRepo, target: created, created: true, reason: `created fork ${created.fullName}` };
}

module.exports = { findForkOf, resolveWriteTarget };
