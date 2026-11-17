# discuss-build

Point this CLI at a repository. It reads that repo's open issues and discussions, picks the concrete, buildable asks, and builds each one on a branch of a fork **you** own. A change only counts as ready when it comes out **lit** (CI green, or a cheap local check that actually passed). The result is a queue. You decide which of those branches, if any, become an upstream pull request.

Author: Joshua Almeida ([@fitzyracing1](https://github.com/fitzyracing1)). MIT.

```
discuss-build <owner/repo>
discuss-build classify <owner/repo>
```

Zero runtime dependencies. Node ≥ 18. Uses the existing `gh` login as the subscriber / runner.

## Subscriber model

A subscriber is the person (or bot account) running the CLI, already logged in to `gh`.

1. They point discuss-build at a source repo, for example `bitcoin/bitcoin` or a project they own.
2. The tool fetches open issues and discussions (most recently updated first, capped) and classifies each one as buildable or not, with a plain-sentence reason.
3. For each small, buildable item, up to a cap (default 3), it creates a branch on a repository the subscriber owns, attempts the change, and pushes that branch.
4. It records whether checks went **lit**, **dark**, or **untested**, and writes `out/queue.md` plus `out/queue.json`.

If the subscriber already owns the source repo, branches are created there. If they do not, the tool uses their existing fork of that repo, even when the fork has been renamed. It will not create a fork unless you pass `--create-fork`.

## Safety rule

**Nothing goes upstream without a human OK.**

discuss-build never opens pull requests, never comments, and never pushes to a repository the runner does not own. It never updates a default branch (`main` / `master`, or whatever the write target uses) and never force-pushes. A lit entry in the queue is a ready branch, not an upstream submission.

## Lit, dark, untested

| Result | Meaning |
| --- | --- |
| **lit** | Fork CI completed green, or (when CI never ran or did not finish) cheap local syntax checks on the changed files passed. |
| **dark** | Fork CI failed, or a cheap local check failed. |
| **untested** | No fork CI appeared, CI was still running when the wait ended, and no cheap local check applied (for example a C++ help-text edit with no existing build tree). |

Heavy projects may not run full CI on a fork, and a complete test suite can take too long to be a default. v0.1 does not pretend those runs happened.

## What v0.1 will actually build

Classification is conservative. RFCs, brainstorming, tracking issues, blank templates, open questions, and large or sensitive protocol changes are not buildable. A question can become buildable if later comments confirm a specific, small change (for example a help-text clarification).

A build is attempted only for **small** items, and only when a patch can be derived safely:

- a unified diff in the issue body, or
- a unique, clearly stated token replacement, or
- a file in `--patch-dir` named `<number>.patch` or `<number>.diff`.

If comments say a plain swap is not safe, the automatic replacement is skipped and a patch file is required. Medium-scope concrete asks still appear in the queue, but they are not auto-built.

## Options

```
--max-build <n>          Max items to build (default 3, cap 10)
--max-fetch <n>          Max issues/discussions to fetch (default 80, cap 200)
--out <dir>              Queue report directory (default out)
--work-dir <dir>         Checkout directory for builds
--fork <owner/repo>      Write target (must be owned by the runner)
--create-fork            Create a fork when the runner does not already have one
--patch-dir <dir>        Apply numbered patch files when present
--only <n,n>             Only consider these issue or discussion numbers
--classify-only          Classify and write the queue; do not build or push
--dry-run                Do not create a fork, push, or comment
--wait-ci-seconds <n>    How long to wait for fork CI (default 180)
--local-test=false       Skip cheap local checks when CI does not finish
```

## Tests

`npm test` runs the offline suite (no network). CI is the `test` workflow on push and pull request.

## License

MIT. Copyright (c) 2026 Joshua Almeida.
