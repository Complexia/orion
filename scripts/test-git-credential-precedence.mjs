import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { runAuthenticatedGit } from '../src/main/source-control.js';

// Exercise real Git's HTTP credential negotiation, rather than asserting that
// an askpass script exists. Git consults configured helpers before askpass.
const exec = promisify(execFile);
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'orion-git-credentials-test-'));
const requests = [];
const server = http.createServer((request, response) => {
  const password = Buffer.from((request.headers.authorization ?? '').replace(/^Basic /, ''), 'base64')
    .toString().split(':').slice(1).join(':');
  if (password) requests.push(password);
  if (password !== 'fresh-test-token') {
    response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Orion test"' });
    response.end();
    return;
  }
  response.writeHead(200, { 'Content-Type': 'application/x-git-upload-pack-advertisement' });
  response.end('001e# service=git-upload-pack\n00000000');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
try {
  await exec('git', ['init', directory]);
  const helper = '!f() { if [ "$1" = get ]; then echo username=orion; echo password=stale-test-token; fi; }; f';
  await exec('git', ['-C', directory, 'config', 'credential.helper', helper]);
  const url = `http://127.0.0.1:${server.address().port}/repo.git`;
  const result = await runAuthenticatedGit({
    gitRoot: directory,
    args: ['ls-remote', url],
    token: 'fresh-test-token',
    timeout: 10_000,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  assert.equal(result.stdout, '');
  assert.deepEqual(requests, ['fresh-test-token']);
  assert.equal((await exec('git', ['-C', directory, 'config', 'credential.helper'])).stdout.trim(), helper,
    'An authenticated operation must leave the user’s saved helper configuration intact.');
  console.log('ok  real HTTP Git uses the supplied credential despite a stale configured helper');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await fs.rm(directory, { recursive: true, force: true });
}
