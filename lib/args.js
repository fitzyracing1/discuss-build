'use strict';

const DEFAULTS = {
  maxBuild: 3,
  maxFetch: 80,
  waitCiSeconds: 180,
  out: 'out',
};

function parseArgs(argv) {
  const args = [...argv];
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) {
        flags[a.slice(2, eq)] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }

  let command = 'run';
  let repo = null;
  if (positional[0] === 'classify' || positional[0] === 'run' || positional[0] === 'help') {
    command = positional[0];
    repo = positional[1] || null;
  } else if (positional[0]) {
    repo = positional[0];
  }

  const intFlag = (name, fallback) => {
    if (!(name in flags)) return fallback;
    const n = Number(flags[name]);
    if (!Number.isFinite(n) || n < 0) throw new Error(`invalid --${name}`);
    return Math.floor(n);
  };

  const only = flags.only
    ? String(flags.only)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.replace(/^#/, ''))
    : null;

  return {
    command,
    repo,
    maxBuild: Math.min(intFlag('max-build', DEFAULTS.maxBuild), 10),
    maxFetch: Math.min(intFlag('max-fetch', DEFAULTS.maxFetch), 200),
    waitCiSeconds: intFlag('wait-ci-seconds', DEFAULTS.waitCiSeconds),
    out: flags.out || DEFAULTS.out,
    workDir: flags['work-dir'] || null,
    fork: flags.fork || null,
    patchDir: flags['patch-dir'] || null,
    classifyOnly: Boolean(flags['classify-only']) || command === 'classify',
    dryRun: Boolean(flags['dry-run']),
    createFork: Boolean(flags['create-fork']),
    localTest: flags['local-test'] !== 'false',
    only,
    help: Boolean(flags.help) || command === 'help',
  };
}

const USAGE = `Usage:
  discuss-build <owner/repo> [options]
  discuss-build classify <owner/repo> [options]

Read open issues and discussions, classify concrete buildable asks, and
(optionally) build them on a branch of a repository the runner owns.

Options:
  --max-build <n>          Max items to build (default 3, cap 10)
  --max-fetch <n>          Max issues/discussions to fetch (default 80, cap 200)
  --out <dir>              Queue report directory (default out)
  --work-dir <dir>         Checkout directory for builds
  --fork <owner/repo>      Write target (must be owned by the runner)
  --create-fork            If the source is not owned, create a fork when missing
  --patch-dir <dir>        Apply <number>.patch / <number>.diff files when present
  --only <n,n>             Only consider these issue or discussion numbers
  --classify-only          Classify and write the queue; do not build or push
  --dry-run                Do not create a fork, push, or comment
  --wait-ci-seconds <n>    How long to wait for fork CI (default 180)
  --local-test=false       Skip cheap local checks when CI does not finish
  --help

Safety:
  discuss-build never opens PRs, never comments, and never pushes to a
  repository the runner does not own. It never updates a default branch
  (main/master) and never force-pushes. Nothing goes upstream unless a
  human opens that change later.
`;

module.exports = { parseArgs, USAGE, DEFAULTS };
