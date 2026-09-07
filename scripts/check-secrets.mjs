import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  runSecretAudit,
  scanTextForTrackedSecrets,
} from '../shared/dust-wave-platform/scripts/scan-tracked-secrets.mjs';

const MAX_BYTES = 5 * 1024 * 1024;

function git(root, args, options = {}) {
  return execFileSync('git', args, {
    cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'], ...options,
  });
}

// The patterns stay in Platform; this adapter adds complete reachable history.
export function scanReachableHistory(root, exactValues = []) {
  if (git(root, ['rev-parse', '--is-shallow-repository']).trim() === 'true') {
    throw new Error('Full Git history is required.');
  }
  const objects = git(root, ['rev-list', '--objects', '--all']).trim();
  if (!objects) return { objectsScanned: 0, findings: [] };
  const ids = [...new Set(objects.split('\n').map(line => line.split(' ', 1)[0]))];
  const metadata = git(root, ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], {
    input: `${ids.join('\n')}\n`,
  });
  const findings = [];
  let objectsScanned = 0;
  for (const line of metadata.trim().split('\n')) {
    const [id, type, sizeText] = line.split(' ');
    if (!/^[a-f0-9]{40,64}$/.test(id) || !['commit', 'tree', 'blob', 'tag'].includes(type)) {
      throw new Error('Git object metadata is incomplete.');
    }
    if (type === 'tree') continue;
    const size = Number(sizeText);
    if (!Number.isSafeInteger(size) || size < 0 || size > MAX_BYTES) {
      findings.push({ file: `git-object:${id}`, label: 'Object exceeds bounded scan coverage; audit incomplete.' });
      continue;
    }
    const content = git(root, ['cat-file', type, id]);
    findings.push(...scanTextForTrackedSecrets(content, `git-object:${id}`));
    if (exactValues.some(value => content.includes(value))) findings.push({file:`git-object:${id}`,label:'Exact local sensitive value detected; value withheld.'});
    objectsScanned += 1;
  }
  return { objectsScanned, findings };
}

export function forbiddenTrackedPaths(root) {
  return git(root, ['ls-files', '-z']).split('\0').filter(Boolean).filter(path =>
    /^(?:\.private|reports|outputs)\//.test(path)
    || /(?:^|\/)\.dev\.vars(?:\.|$)/.test(path)
    || /(?:^|\/)\.env(?:\.|$)/.test(path) && !path.endsWith('.env.example')
    || /\.(?:pem|key|bundle)$/.test(path)
  );
}

function main() {
  const root = process.cwd();
  try {
    let ok = runSecretAudit({ root, localSecretFiles: ['.dev.vars', '.env'] });
    const forbidden = forbiddenTrackedPaths(root);
    for (const path of forbidden) console.error(`Private/generated file must not be tracked: ${path}`);
    ok = ok && forbidden.length === 0;
    let exactValues = [];
    try {
      const local = JSON.parse(readFileSync(resolve(root, '.private/runtime-secrets.json'), 'utf8'));
      exactValues = Object.entries(local).filter(([name,value]) => /(?:TOKEN|PRIVATE_KEY|_EMAIL)$/.test(name) && typeof value === 'string' && value.length >= 8).flatMap(([,value]) => [value, JSON.stringify(value).slice(1,-1)]);
    } catch (error) { if(error.code !== 'ENOENT') throw error; }
    for (const path of git(root, ['ls-files', '-z']).split('\0').filter(Boolean)) {
      try { if (exactValues.some(value => readFileSync(resolve(root,path),'utf8').includes(value))) {console.error(`${path}: Exact local sensitive value detected; value withheld.`);ok=false;} }
      catch (error) { if (error.code !== 'EISDIR') throw error; }
    }
    const history = scanReachableHistory(root, exactValues);
    for (const finding of history.findings) console.error(`${finding.file}: ${finding.label}`);
    if (history.findings.length) ok = false;
    console.log(`Reachable-history credential scan: ${history.objectsScanned} objects, ${history.findings.length} findings.`);
    if (!ok) process.exitCode = 1;
  } catch {
    console.error('Secret audit incomplete; check submodule availability and full Git history. No secret values are printed.');
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] || '')).href) main();
