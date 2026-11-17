'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { defaultExec } = require('../lib/github');

describe('defaultExec', () => {
  it('runs the command in the provided cwd', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-exec-'));
    fs.writeFileSync(path.join(dir, 'marker.txt'), 'ok\n');
    const result = await defaultExec('pwd', [], { cwd: dir });
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), dir);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
