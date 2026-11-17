'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { classify } = require('../lib/classify');

describe('classify', () => {
  it('rejects RFCs, tracking issues, and brainstorming', () => {
    const r = classify({
      type: 'issue',
      number: 1,
      title: '[RFC] build: Configuration macro names are susceptible to typos',
      body: 'We should discuss renaming macros.',
      labels: ['Brainstorming', 'Build system'],
    });
    assert.equal(r.buildable, false);
    assert.match(r.reason, /RFC|brainstorming|tracking/i);
  });

  it('rejects blank request templates', () => {
    const r = classify({
      title: 'Rule request: propose a new fake-green detector',
      body: `### Proposed rule id\nkebab-case-id (optional if unsure)\n\n### What fake-green behavior should it catch?\nDescribe the agent/CI trick in one short paragraph.\n\n### Example diff (true positive)\n\`\`\`diff\n\n\`\`\`\n`,
      labels: ['enhancement'],
    });
    assert.equal(r.buildable, false);
    assert.match(r.reason, /blank request template/i);
  });

  it('rejects help-wanted story collection', () => {
    const r = classify({
      title: 'Help wanted: share a real agent catch (dogfood stories)',
      body: 'If this tool blocked an agent, tell us about it here.',
      labels: ['help wanted'],
    });
    assert.equal(r.buildable, false);
    assert.match(r.reason, /stories, discussion, or open-ended help/i);
  });

  it('rejects a release schedule note', () => {
    const r = classify({ title: 'Release Schedule for v33.0', body: 'Target dates for the next release.', labels: [] });
    assert.equal(r.buildable, false);
    assert.match(r.reason, /release-process/i);
  });

  it('rejects an unresolved clarification question', () => {
    const r = classify({
      title: 'Clarify -ipcbind syntax when using max-connections with the default Unix socket',
      body: 'Is -ipcbind=unix:,max-connections=8 the intended syntax, and is the colon required?\n\nThis report is asking for clarification rather than asserting that a confirmed bug exists.',
      labels: [],
      comments: [],
    });
    assert.equal(r.buildable, false);
    assert.match(r.reason, /question or for clarification/i);
  });

  it('accepts the same question once comments confirm a help-text change', () => {
    const r = classify({
      title: 'Clarify -ipcbind syntax when using max-connections with the default Unix socket',
      body: 'Is -ipcbind=unix:,max-connections=8 the intended syntax, and is the colon required?\n\nThis report is asking for clarification rather than asserting that a confirmed bug exists.',
      labels: [],
      comments: [
        { body: '-ipcbind=unix:,max-connections=8 is the intended syntax. The colon is required.' },
        { body: "I'll update the help text to show the correct syntax and explain that the colon is required." },
      ],
    });
    assert.equal(r.buildable, true);
    assert.equal(r.scope, 'small');
    assert.match(r.reason, /small, clearly scoped/i);
  });

  it('accepts a small deprecated CI flag fix', () => {
    const r = classify({
      title: 'build: CMake `-Werror=dev` option is deprecated',
      body: 'According to CI output, `-Werror=dev` is now deprecated. Use `-Werror=author` instead.',
      labels: ['Build system'],
      comments: [{ body: "it's a straightforward fix to the CI scripts and tests." }],
    });
    assert.equal(r.buildable, true);
    assert.equal(r.scope, 'small');
  });

  it('marks a clearly specified but broader util change as medium', () => {
    const r = classify({
      title: 'util: Make files opened via fsbridge::fopen() not inheritable by child processes',
      body: 'They should not be inherited. On POSIX this can be achieved with O_CLOEXEC. On Windows, with the N mode flag (_O_NOINHERIT). Child processes such as -signer commands should not see the node open files.',
      labels: [],
    });
    assert.equal(r.buildable, true);
    assert.equal(r.scope, 'medium');
  });

  it('accepts a small docs or template ask', () => {
    const r = classify({
      title: 'Good first issue: add GitHub issue templates for FP + rule requests',
      body: 'Add .github/ISSUE_TEMPLATE/ forms.\n\n### Acceptance\n- Templates appear in the New issue chooser\n- Labels auto-applied\n\nThis is docs/meta only — no CLI changes required.',
      labels: ['documentation', 'good first issue'],
    });
    assert.equal(r.buildable, true);
    assert.equal(r.scope, 'small');
  });

  it('accepts a concrete per-file test-floor feature as small when the ask is narrow', () => {
    const r = classify({
      title: 'Per-file assertion-count floor: flag any test file whose assert count drops vs base',
      body: 'Count assertions per test file on the base branch and on the PR head. Fail when any file\'s assertion count drops without a matching test removal. Check per file, not just the repo total.',
      labels: [],
    });
    assert.equal(r.buildable, true);
    assert.equal(r.scope, 'small');
  });

  it('gives a plain-sentence reason when nothing concrete is specified', () => {
    const r = classify({
      title: 'Callback/notification documentation and cleanup',
      body: 'Various ideas for documenting notifications over time.',
      labels: ['Docs'],
    });
    assert.equal(r.buildable, false);
    assert.match(r.reason, /No concrete, buildable change/);
  });
});
