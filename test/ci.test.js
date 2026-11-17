'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeChecks, combineResults, cheapChecksFor } = require('../lib/ci');

describe('ci', () => {
  it('marks passing and failing GitHub checks', () => {
    const lit = summarizeChecks({
      checks: [{ name: 'test', conclusion: 'success', status: 'completed' }],
      status: { statuses: [] },
    });
    assert.equal(lit.failed.length, 0);
    assert.equal(lit.passed.length, 1);

    const dark = summarizeChecks({
      checks: [{ name: 'test', conclusion: 'failure', status: 'completed' }],
      status: { statuses: [] },
    });
    assert.equal(dark.failed.length, 1);
  });

  it('prefers CI, then local checks, otherwise untested', () => {
    assert.equal(combineResults({ status: 'lit', summary: 'CI passed' }, { status: 'dark', summary: 'local failed' }).status, 'lit');
    assert.equal(combineResults({ status: 'untested', summary: 'no CI' }, { status: 'lit', summary: 'local passed' }).status, 'lit');
    assert.equal(combineResults({ status: 'untested', summary: 'no CI' }, { status: 'dark', summary: 'local failed' }).status, 'dark');
    assert.equal(combineResults({ status: 'untested', summary: 'no CI' }, { status: 'untested', summary: 'no local' }).status, 'untested');
  });

  it('selects cheap syntax checks by file type', () => {
    const checks = cheapChecksFor(['ci/test.sh', 'tools/x.py', 'lib/a.js', 'README.md']);
    assert.deepEqual(checks.map((c) => c.kind), ['bash-n', 'py-compile', 'node-check']);
  });
});
