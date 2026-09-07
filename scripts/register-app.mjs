import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';

// Operator-only, loopback manifest handshake. Secrets never pass through stdout.
await mkdir('.private', { recursive: true, mode: 0o700 });
try { await access('.private/app.json'); throw new Error('App already registered locally'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const state = randomBytes(24).toString('hex');
const port = 43187;
const manifest = {
  name: 'Dust Wave Repo Scan', url: 'https://github.com/aindaco1/github-repo-scan',
  description: 'Read-only weekly repository maintenance reports and a Codex handoff.',
  public: false, redirect_url: `http://127.0.0.1:${port}/callback`,
  hook_attributes: { url: 'https://github.com/aindaco1/github-repo-scan', active: false },
  default_permissions: Object.fromEntries(['actions', 'contents', 'issues', 'pull_requests', 'checks', 'statuses', 'deployments', 'metadata'].map(key => [key, 'read'])),
  default_events: [],
};
const html = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
let converting = false;
const server = createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.headers.host !== `127.0.0.1:${port}`) { res.writeHead(400).end(); return; }
  const url = new URL(req.url, `http://127.0.0.1:${port}`);
  if (req.method === 'GET' && url.pathname === '/') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<h1>Register GitHub Repo Scan</h1><p>Read-only: Actions, Contents, Issues, Pull requests, Checks, Statuses, Deployments and Metadata. Only the owner can install this App.</p><form action="https://github.com/settings/apps/new?state=${state}" method="post"><input type="hidden" name="manifest" value="${html(JSON.stringify(manifest))}"><button>Register read-only GitHub App</button></form>`);
    return;
  }
  if (req.method !== 'GET' || url.pathname !== '/callback' || url.searchParams.get('state') !== state || !url.searchParams.get('code') || converting) { res.writeHead(400).end('Invalid request'); return; }
  converting = true;
  try {
    const result = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(url.searchParams.get('code'))}/conversions`, {method:'POST', headers:{Accept:'application/vnd.github+json','User-Agent':'github-repo-scan-setup'}});
    if (!result.ok) throw new Error(`GitHub HTTP ${result.status}`);
    const app = await result.json();
    if (!app.id || !app.pem || !app.slug) throw new Error('Invalid App response');
    await writeFile('.private/app.json', JSON.stringify({id:app.id, clientId:app.client_id, slug:app.slug, pem:app.pem}), {mode:0o600, flag:'wx'});
    console.log('App registration saved privately. Install the App next.');
    res.writeHead(303, {Location:`https://github.com/apps/${encodeURIComponent(app.slug)}/installations/new`}).end();
  } catch { res.writeHead(500).end('Registration exchange failed. Inspect setup state before retrying.'); console.error('Registration exchange failed; no secret values logged.'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Setup form: http://127.0.0.1:${port}`));
