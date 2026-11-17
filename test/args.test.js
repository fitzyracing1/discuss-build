'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../lib/args');

describe('args', () => {
  it('parses a repo and common flags', () => {
    const o = parseArgs(['bitcoin/bitcoin', '--max-build', '3', '--classify-only', '--fork', 'fitzyracing1/viper', '--only', '36780,36657']);
    assert.equal(o.command, 'run');
    assert.equal(o.repo, 'bitcoin/bitcoin');
    assert.equal(o.maxBuild, 3);
    assert.equal(o.classifyOnly, true);
    assert.equal(o.fork, 'fitzyracing1/viper');
    assert.deepEqual(o.only, ['36780', '36657']);
  });

  it('treats classify as a subcommand', () => {
    const o = parseArgs(['classify', 'acme/app', '--dry-run']);
    assert.equal(o.command, 'classify');
    assert.equal(o.repo, 'acme/app');
    assert.equal(o.classifyOnly, true);
    assert.equal(o.dryRun, true);
  });

  it('caps max-build and max-fetch', () => {
    const o = parseArgs(['acme/app', '--max-build', '99', '--max-fetch', '500']);
    assert.equal(o.maxBuild, 10);
    assert.equal(o.maxFetch, 200);
  });
});
