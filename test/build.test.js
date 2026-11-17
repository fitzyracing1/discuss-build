'use strict';
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  extractUnifiedDiff,
  extractExactReplacement,
  commentsBlockPlainSwap,
  applyExactReplacement,
  findPatchFile,
  attemptBuild,
} = require('../lib/build');

describe('build helpers', () => {
  it('extracts a fenced unified diff and ignores empty fences', () => {
    assert.equal(extractUnifiedDiff('```diff\n\n```'), null);
    const body = [
      'Please apply this.',
      '```diff',
      'diff --git a/README.md b/README.md',
      '--- a/README.md',
      '+++ b/README.md',
      '@@ -1,1 +1,1 @@',
      '-hello',
      '+hello world',
      '```',
    ].join('\n');
    const diff = extractUnifiedDiff(body);
    assert.match(diff, /diff --git a\/README.md/);
    assert.match(diff, /\+hello world/);
  });

  it('parses exact replacements but refuses a documented unsafe plain swap', () => {
    const ok = extractExactReplacement({
      title: 'build: flag is deprecated',
      body: '`-Werror=dev` is deprecated. Use `-Werror=author` instead.',
      comments: [],
    });
    assert.deepEqual(ok, { from: '-Werror=dev', to: '-Werror=author' });

    assert.equal(
      commentsBlockPlainSwap('A plain swap isn\'t safe: on CMake 3.28, -Werror=author is accepted but silently ignored.'),
      true
    );
    const blocked = extractExactReplacement({
      title: 'build: flag is deprecated',
      body: '`-Werror=dev` is deprecated. Use `-Werror=author` instead.',
      comments: [{ body: "A plain swap isn't safe: choose the flag by CMake version." }],
    });
    assert.equal(blocked, null);
  });

  it('replaces a unique token and refuses a widespread one', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-repl-'));
    fs.writeFileSync(path.join(dir, 'ci.sh'), 'cmake -S . -B build -Werror=dev\n');
    fs.writeFileSync(path.join(dir, 'README.md'), 'See the flag.\n');
    const once = applyExactReplacement(dir, '-Werror=dev', '-Werror=author');
    assert.equal(once.applied, true);
    assert.equal(fs.readFileSync(path.join(dir, 'ci.sh'), 'utf8'), 'cmake -S . -B build -Werror=author\n');

    fs.writeFileSync(path.join(dir, 'a.txt'), 'foo foo foo\n');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'foo foo foo foo foo foo foo foo foo foo foo foo foo foo foo foo foo foo foo foo foo\n');
    const many = applyExactReplacement(dir, 'foo', 'bar', { maxHits: 5 });
    assert.equal(many.applied, false);
    assert.match(many.reason, /occurs/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('finds numbered patch files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-patch-'));
    const file = path.join(dir, '36657.patch');
    fs.writeFileSync(file, 'diff --git a/x b/x\n');
    assert.equal(findPatchFile(dir, 36657), file);
    assert.equal(findPatchFile(dir, 1), null);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('skips an unsafe swap when no patch file is supplied', async () => {
    const r = await attemptBuild({
      item: {
        number: 36780,
        title: 'build: CMake `-Werror=dev` option is deprecated',
        body: '`-Werror=dev` is deprecated. Use `-Werror=author` instead.',
        comments: [{ body: "A plain swap isn't safe: choose the flag by CMake version." }],
      },
      workDir: os.tmpdir(),
      patchDir: null,
      exec: async () => ({ status: 1, stdout: '', stderr: 'no' }),
    });
    assert.equal(r.applied, false);
    assert.match(r.reason, /not safe/);
  });
});
