'use strict';
const path = require('path');
const { parseArgs, USAGE } = require('./args');
const { createClient } = require('./github');
const { resolveWriteTarget } = require('./fork');
const { classifyAll } = require('./classify');
const { assertAllowedAction, assertCanWriteTarget, branchNameFor } = require('./safety');
const { ensureWorktree, createBuildBranch, commitAll, pushBranch, githubHttps } = require('./git');
const { attemptBuild, commitMessage } = require('./build');
const { runCheapLocalTests, waitForCi, combineResults } = require('./ci');
const { writeReports, emptyDoc } = require('./report');
const { createGit } = require('./git');

function log(msg) {
  console.error('  ' + msg);
}

async function main(argv, deps = {}) {
  const opts = parseArgs(argv);
  if (opts.help || !opts.repo) {
    console.log(USAGE);
    if (!opts.help && !opts.repo) {
      throw new Error('a repository of the form owner/repo is required');
    }
    return { usage: true };
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(opts.repo)) {
    throw new Error(`invalid repo: ${opts.repo}`);
  }

  const client = deps.client || createClient({ exec: deps.exec });
  const exec = deps.exec || client.run;
  const now = deps.now || (() => new Date().toISOString());
  const outDir = path.resolve(opts.out);
  const limits = [];

  const runner = await client.whoami();
  log(`runner ${runner}`);

  const sourceInfo = await client.repoInfo(opts.repo);
  const sourceName = sourceInfo.fullName;
  if (sourceName.toLowerCase() !== opts.repo.toLowerCase()) {
    log(`source ${opts.repo} resolves to ${sourceName}`);
  }
  const sourceSha = await client.defaultSha(sourceName, sourceInfo.defaultBranch);
  log(`source default ${sourceInfo.defaultBranch} @ ${sourceSha.slice(0, 12)}`);

  let issues = [];
  let discussions = [];
  try {
    issues = await client.fetchIssues(sourceName, { maxFetch: opts.maxFetch });
  } catch (err) {
    limits.push(`Could not fetch all issues: ${err.message}`);
    log(`issue fetch warning: ${err.message}`);
  }
  try {
    discussions = await client.fetchDiscussions(sourceName, { maxFetch: opts.maxFetch });
  } catch (err) {
    limits.push(`Could not fetch discussions: ${err.message}`);
    log(`discussion fetch warning: ${err.message}`);
  }

  let items = issues.concat(discussions);
  if (opts.only) {
    const allow = new Set(opts.only.map(String));
    items = items.filter((i) => allow.has(String(i.number)));
  }
  if (issues.length + discussions.length >= opts.maxFetch) {
    limits.push(`Only the ${opts.maxFetch} most recently updated issues and discussions were fetched.`);
  }

  const classified = classifyAll(items).map((row) => ({
    item: row.item,
    buildable: row.buildable,
    scope: row.scope,
    reason: row.reason,
    built: false,
    branch: null,
    sha: null,
    ciStatus: null,
    ciSummary: null,
    buildNotes: null,
    skipReason: null,
  }));

  const write = await resolveWriteTarget({
    client,
    source: sourceInfo,
    runner,
    forkOverride: opts.fork,
    createFork: opts.createFork && !opts.dryRun && !opts.classifyOnly,
    dryRun: opts.dryRun || opts.classifyOnly,
    log,
  }).catch((err) => {
    if (opts.classifyOnly) {
      limits.push(err.message);
      return { source: sourceInfo, target: null, created: false, reason: err.message };
    }
    throw err;
  });

  const toBuild = [];
  if (!opts.classifyOnly) {
    for (const row of classified) {
      if (!row.buildable) continue;
      if (row.scope !== 'small') {
        row.skipReason = 'Skipped because the scope is larger than the small automatic-build cap.';
        continue;
      }
      if (toBuild.length >= opts.maxBuild) {
        row.skipReason = `Skipped because the build cap of ${opts.maxBuild} was already reached.`;
        continue;
      }
      toBuild.push(row);
    }
  } else {
    for (const row of classified) {
      if (row.buildable && row.scope === 'small') {
        row.skipReason = 'Classify-only run; nothing was built or pushed.';
      } else if (row.buildable) {
        row.skipReason = 'Classify-only run; scope is larger than the small automatic-build cap.';
      }
    }
  }

  if (toBuild.length && !opts.dryRun && write.target) {
    assertCanWriteTarget({
      source: write.source,
      target: write.target,
      runner,
      targetIsForkOfSource: true,
    });
    const workDir = path.resolve(opts.workDir || path.join(outDir, 'work', write.source.name));
    await ensureWorktree({
      exec,
      workDir,
      sourceUrl: githubHttps(write.source.fullName),
      sourceBranch: write.source.defaultBranch,
      log,
    });

    for (const row of toBuild) {
      const branch = branchNameFor(row.item);
      try {
        await createBuildBranch({
          exec,
          workDir,
          branch,
          defaultBranch: write.target.defaultBranch,
          log,
        });
        const attempt = await attemptBuild({
          item: row.item,
          workDir,
          patchDir: opts.patchDir,
          exec,
          log,
        });
        if (!attempt.applied) {
          row.skipReason = attempt.reason;
          row.buildNotes = attempt.reason;
          continue;
        }
        const sha = await commitAll({
          exec,
          workDir,
          message: commitMessage(write.source.fullName, row.item),
        });
        if (!sha) {
          row.skipReason = 'the patch produced no file changes';
          row.buildNotes = attempt.reason;
          continue;
        }
        row.built = true;
        row.branch = branch;
        row.sha = sha;
        row.buildNotes = attempt.reason;

        const git = createGit({ exec, cwd: workDir }).git;
        const files = String(await git(['show', '--pretty=', '--name-only', sha]))
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean);

        assertAllowedAction('push', write.target, runner);
        await pushBranch({
          exec,
          workDir,
          remoteUrl: githubHttps(write.target.fullName),
          branch,
          defaultBranch: write.target.defaultBranch,
          log,
        });

        let ci = { status: 'untested', summary: 'CI wait skipped' };
        if (opts.waitCiSeconds > 0) {
          ci = await waitForCi({
            client,
            fullName: write.target.fullName,
            sha,
            waitSeconds: opts.waitCiSeconds,
            log,
          });
        }
        let local = null;
        if (opts.localTest && ci.status !== 'lit' && ci.status !== 'dark') {
          local = await runCheapLocalTests({ exec, workDir, files, log });
        }
        const combined = combineResults(ci, local);
        row.ciStatus = combined.status;
        row.ciSummary = combined.summary;
        row.buildNotes = [attempt.reason, combined.summary].filter(Boolean).join(' — ');
      } catch (err) {
        row.skipReason = `build failed: ${err.message}`;
        row.buildNotes = err.message;
        log(`build failed for #${row.item.number}: ${err.message}`);
      }
    }
  } else if (toBuild.length && opts.dryRun) {
    for (const row of toBuild) {
      row.skipReason = 'Dry-run; the change was not applied or pushed.';
      row.branch = branchNameFor(row.item);
    }
  }

  if (write.target && write.target.defaultBranch) {
    limits.push(`The write target default branch (${write.target.defaultBranch}) was not updated.`);
  }
  limits.push('No pull requests or comments were opened, including on the source repository.');
  if (write.source && write.target && write.source.fullName !== write.target.fullName) {
    limits.push(`Builds used ${write.source.fullName} as the base tip and were pushed only to ${write.target.fullName}.`);
  }

  const doc = emptyDoc({
    source: write.source.fullName || sourceName,
    target: write.target ? write.target.fullName : null,
    targetReason: write.reason,
    runner,
    sourceDefault: write.source.defaultBranch || sourceInfo.defaultBranch,
    sourceSha,
    generatedAt: now(),
    dryRun: opts.dryRun,
    classifyOnly: opts.classifyOnly,
    items: classified,
    limits,
  });
  const { jsonPath, mdPath } = writeReports(outDir, doc);
  const lit = classified.filter((i) => i.ciStatus === 'lit').length;
  const dark = classified.filter((i) => i.ciStatus === 'dark').length;
  const built = classified.filter((i) => i.built).length;
  console.log(
    `discuss-build ${sourceName}: fetched ${classified.length}, buildable ${classified.filter((i) => i.buildable).length}, built ${built}, lit ${lit}, dark ${dark}\n  queue: ${mdPath}\n  json: ${jsonPath}`
  );
  return doc;
}

module.exports = { main };
