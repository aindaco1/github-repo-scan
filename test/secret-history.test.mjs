import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import test from 'node:test';
import { scanReachableHistory, forbiddenTrackedPaths } from '../scripts/check-secrets.mjs';

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'repo-scan-secret-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  git('init', '-b', 'main');
  git('config', 'user.name', 'Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  return { root, git };
}

test('a credential removed from current source is still detected in history without exposing its value', t => {
  const { root, git } = repository(t);
  const synthetic = ['re', 'A'.repeat(32)].join('_');
  writeFileSync(join(root, 'fixture.txt'), synthetic);
  git('add', 'fixture.txt');
  git('commit', '-m', 'Synthetic credential fixture');
  writeFileSync(join(root, 'fixture.txt'), 'Removed');
  git('commit', '-am', 'Remove fixture');
  const result = scanReachableHistory(root);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].label, 'Resend API key');
  assert.equal(JSON.stringify(result).includes(synthetic), false);
});

test('a force-added private configuration file is rejected even if no credential pattern matches', t => {
  const { root, git } = repository(t);
  writeFileSync(join(root, '.gitignore'), '.dev.vars\n');
  writeFileSync(join(root, '.dev.vars'), 'DIGEST_TO_EMAIL=fixture@example.invalid\n');
  git('add', '.gitignore');
  git('add', '-f', '.dev.vars');
  assert.deepEqual(forbiddenTrackedPaths(root), ['.dev.vars']);
});

test('shallow history is rejected instead of reporting complete coverage', t => {
  const { root, git } = repository(t);
  writeFileSync(join(root, 'fixture.txt'), 'safe');
  git('add', 'fixture.txt');
  git('commit', '-m', 'Safe fixture');
  const clone = join(root, 'shallow-copy');
  git('clone', '--depth', '1', `file://${root}`, clone);
  assert.throws(() => scanReachableHistory(clone), /Full Git history/);
});
