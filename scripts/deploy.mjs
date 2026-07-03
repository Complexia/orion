#!/usr/bin/env node

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await loadEnvFile(path.join(rootDir, '.env.release.local'));

const args = parseArgs(process.argv.slice(2));
const platform = args.platform ?? process.platform;
const arch = args.arch ?? process.arch;
const osName = platform === 'darwin' ? 'macos' : platform === 'win32' ? 'windows' : 'linux';
const bump = args.bump ?? (args.resumeNotaryId ? 'none' : 'patch');
const isMacRelease = platform === 'darwin';
const macSigningIdentity = process.env.ORION_MAC_SIGN_IDENTITY
  ?? 'Developer ID Application: R&R Unicorns, LLC (KV46DBU287)';
const macNotaryProfile = process.env.ORION_MAC_NOTARY_PROFILE ?? 'orion-notary';
const macSignedRelease = isMacRelease;

const packagePath = path.join(rootDir, 'package.json');
const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'));
const currentVersion = packageJson.version;
const version = args.version ?? (bump === 'none' ? currentVersion : bumpVersion(currentVersion, bump));

const config = {
  bucket: process.env.ORION_R2_BUCKET ?? 'orion-builds',
  endpoint: process.env.ORION_R2_ENDPOINT,
  accessKeyId: process.env.R2_ACCESS_KEY_ID ?? process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? process.env.AWS_SECRET_ACCESS_KEY,
};

for (const [key, value] of Object.entries(config)) {
  if (!value) throw new Error(`Missing required release environment value: ${key}`);
}

if (version !== currentVersion) {
  packageJson.version = version;
  await writeJson(packagePath, packageJson);
  await updatePackageLockVersion(version);
  console.log(`Bumped Orion from ${currentVersion} to ${version}`);
} else if (args.resumeNotaryId) {
  console.log(`Resuming Orion ${version} notarization submission ${args.resumeNotaryId}`);
} else {
  console.log(`Building Orion ${version}`);
}

if (!args.resumeNotaryId) {
  await fs.rm(path.join(rootDir, 'out', 'make'), { recursive: true, force: true });
  run('bun', ['run', 'make', '--', `--platform=${platform}`, `--arch=${arch}`]);
}

const artifactPaths = await findArtifacts(path.join(rootDir, 'out', 'make'));
if (artifactPaths.length === 0) {
  throw new Error('No distributable artifacts were produced in out/make');
}

if (isMacRelease) {
  const macAppPath = await findMacApp(arch);
  await verifyMacAppSignature(macAppPath);
  await notarizeMacArtifacts(artifactPaths, macAppPath, macSigningIdentity, macNotaryProfile, args.resumeNotaryId);
  await assessMacApp(macAppPath);
}

const client = new S3Client({
  region: 'auto',
  endpoint: config.endpoint,
  credentials: {
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
  },
});

const releasedAt = new Date().toISOString();
const artifacts = [];

for (const artifactPath of artifactPaths) {
  const ext = path.extname(artifactPath);
  const kind = artifactKindFor(osName, ext);
  const fileName = `Orion-${version}-${osName}-${arch}${ext}`;
  const key = `releases/v${version}/${osName}/${arch}/${fileName}`;
  const stat = await fs.stat(artifactPath);
  const sha256 = await sha256File(artifactPath);
  const sha512 = await sha512File(artifactPath);
  const contentType = contentTypeFor(ext);

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: createReadStream(artifactPath),
    ContentLength: stat.size,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable',
    Metadata: {
      product: 'orion',
      version,
      platform: osName,
      arch,
      sha256,
      sha512,
      kind,
      signed: macSignedRelease ? 'true' : 'false',
      notarized: macSignedRelease ? 'true' : 'false',
      unsigned: macSignedRelease ? 'false' : 'true',
    },
  }));

  artifacts.push({
    kind,
    platform: osName,
    arch,
    key,
    fileName,
    size: stat.size,
    sha256,
    sha512,
    contentType,
    signed: macSignedRelease,
    notarized: macSignedRelease,
    unsigned: !macSignedRelease,
  });

  console.log(`Uploaded ${key}`);
}

const downloads = {};
const updates = {};
for (const artifact of artifacts) {
  if (artifact.kind === 'update') {
    updates[artifact.platform] ??= {};
    updates[artifact.platform][artifact.arch] = artifact;
  } else {
    downloads[artifact.platform] ??= {};
    downloads[artifact.platform][artifact.arch] = artifact;
  }
}

const manifest = {
  product: 'Orion',
  version,
  channel: 'stable',
  releasedAt,
  signed: macSignedRelease,
  notarized: macSignedRelease,
  unsigned: !macSignedRelease,
  downloads,
  updates,
  artifacts,
};

await uploadJson(client, config.bucket, `releases/v${version}/manifest.json`, manifest, 'public, max-age=31536000, immutable');
await uploadJson(client, config.bucket, 'releases/latest.json', manifest, 'no-store');

console.log(`Published Orion ${version}`);
console.log('Latest manifest: releases/latest.json');

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--version') parsed.version = argv[++index];
    else if (value.startsWith('--version=')) parsed.version = value.split('=')[1];
    else if (value === '--bump') parsed.bump = argv[++index];
    else if (value.startsWith('--bump=')) parsed.bump = value.split('=')[1];
    else if (value === '--platform') parsed.platform = argv[++index];
    else if (value.startsWith('--platform=')) parsed.platform = value.split('=')[1];
    else if (value === '--arch') parsed.arch = argv[++index];
    else if (value.startsWith('--arch=')) parsed.arch = value.split('=')[1];
    else if (value === '--resume-notary-id') parsed.resumeNotaryId = argv[++index];
    else if (value.startsWith('--resume-notary-id=')) parsed.resumeNotaryId = value.split('=')[1];
    else throw new Error(`Unknown argument: ${value}`);
  }
  return parsed;
}

function bumpVersion(version, bumpType) {
  if (!['major', 'minor', 'patch'].includes(bumpType)) {
    throw new Error(`Invalid bump "${bumpType}". Use major, minor, patch, or none.`);
  }

  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`Cannot automatically bump non-semver version "${version}"`);

  const next = match.slice(1).map(Number);
  if (bumpType === 'major') {
    next[0] += 1;
    next[1] = 0;
    next[2] = 0;
  } else if (bumpType === 'minor') {
    next[1] += 1;
    next[2] = 0;
  } else {
    next[2] += 1;
  }
  return next.join('.');
}

function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${result.status}`);
  }
}

function tryRun(command, commandArgs) {
  const result = spawnSync(command, commandArgs, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
  });
  return result.status === 0;
}

async function verifyMacAppSignature(appPath) {
  console.log(`Verifying signed app: ${path.relative(rootDir, appPath)}`);
  run('codesign', ['-dv', '--verbose=4', appPath]);
  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath]);
}

async function assessMacApp(appPath) {
  console.log(`Assessing notarized app: ${path.relative(rootDir, appPath)}`);
  run('spctl', ['-a', '-vvv', '-t', 'exec', appPath]);
}

async function findMacApp(arch) {
  const preferred = path.join(rootDir, 'out', `Orion-darwin-${arch}`, 'Orion.app');
  try {
    const stat = await fs.stat(preferred);
    if (stat.isDirectory()) return preferred;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const appPaths = (await walk(path.join(rootDir, 'out')))
    .filter((entry) => entry.endsWith(`${path.sep}Orion.app${path.sep}Contents${path.sep}Info.plist`))
    .map((entry) => entry.slice(0, -`${path.sep}Contents${path.sep}Info.plist`.length));

  if (appPaths.length === 0) {
    throw new Error('Unable to find packaged Orion.app for signing verification');
  }

  return appPaths.sort()[0];
}

async function notarizeMacArtifacts(artifactPaths, appPath, signingIdentity, keychainProfile, resumeNotaryId) {
  const dmgPaths = artifactPaths.filter((artifactPath) => path.extname(artifactPath).toLowerCase() === '.dmg');
  const zipPaths = artifactPaths.filter((artifactPath) => path.extname(artifactPath).toLowerCase() === '.zip');
  if (dmgPaths.length === 0) {
    throw new Error('macOS release did not produce a DMG to notarize');
  }

  if (resumeNotaryId && dmgPaths.length > 1) {
    throw new Error('Cannot resume one notarization submission for multiple DMGs');
  }

  for (const dmgPath of dmgPaths) {
    if (resumeNotaryId) {
      await verifyMacDmgSignature(dmgPath);
      console.log(`Waiting for existing DMG notarization: ${resumeNotaryId}`);
      run('xcrun', ['notarytool', 'wait', resumeNotaryId, '--keychain-profile', keychainProfile]);
    } else {
      await signMacDmg(dmgPath, signingIdentity);
      console.log(`Notarizing DMG: ${path.relative(rootDir, dmgPath)}`);
      run('xcrun', ['notarytool', 'submit', dmgPath, '--keychain-profile', keychainProfile, '--wait']);
    }

    run('xcrun', ['stapler', 'staple', dmgPath]);
    run('spctl', ['-a', '-vvv', '-t', 'open', '--context', 'context:primary-signature', dmgPath]);
  }

  await stapleMacApp(appPath, zipPaths, keychainProfile, resumeNotaryId);
  await repackMacUpdateZips(appPath, zipPaths);
}

async function signMacDmg(dmgPath, signingIdentity) {
  console.log(`Signing DMG: ${path.relative(rootDir, dmgPath)}`);
  run('codesign', ['--force', '--sign', signingIdentity, '--timestamp', dmgPath]);
  await verifyMacDmgSignature(dmgPath);
}

async function verifyMacDmgSignature(dmgPath) {
  console.log(`Verifying signed DMG: ${path.relative(rootDir, dmgPath)}`);
  run('codesign', ['-dv', '--verbose=4', dmgPath]);
  run('codesign', ['--verify', '--verbose=2', dmgPath]);
}

async function stapleMacApp(appPath, zipPaths, keychainProfile, resumeNotaryId) {
  console.log(`Stapling notarization ticket to app: ${path.relative(rootDir, appPath)}`);
  if (tryRun('xcrun', ['stapler', 'staple', appPath])) return;

  if (resumeNotaryId || zipPaths.length === 0) {
    throw new Error('Could not staple notarization ticket to Orion.app');
  }

  const zipPath = zipPaths[0];
  console.log(`Submitting update ZIP for app notarization: ${path.relative(rootDir, zipPath)}`);
  run('xcrun', ['notarytool', 'submit', zipPath, '--keychain-profile', keychainProfile, '--wait']);
  run('xcrun', ['stapler', 'staple', appPath]);
}

async function repackMacUpdateZips(appPath, zipPaths) {
  for (const zipPath of zipPaths) {
    console.log(`Repacking update ZIP with stapled app: ${path.relative(rootDir, zipPath)}`);
    await fs.rm(zipPath, { force: true });
    run('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zipPath]);
  }
}

async function loadEnvFile(filePath) {
  let contents;
  try {
    contents = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, '');
  }
}

async function updatePackageLockVersion(version) {
  const lockPath = path.join(rootDir, 'package-lock.json');
  let lock;
  try {
    lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }

  lock.version = version;
  if (lock.packages?.['']) lock.packages[''].version = version;
  await writeJson(lockPath, lock);
}

async function writeJson(filePath, value) {
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function findArtifacts(dir) {
  const entries = await walk(dir);
  return entries
    .filter((entry) => /\.(zip|dmg|exe|deb|rpm)$/i.test(entry))
    .sort();
}

async function walk(dir) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

async function sha256File(filePath) {
  return hashFile(filePath, 'sha256');
}

async function sha512File(filePath) {
  return hashFile(filePath, 'sha512', 'base64');
}

async function hashFile(filePath, algorithm, encoding = 'hex') {
  const hasher = createHash(algorithm);
  const file = await fs.open(filePath, 'r');
  try {
    for await (const chunk of file.readableWebStream()) hasher.update(Buffer.from(chunk));
  } finally {
    await file.close();
  }
  return hasher.digest(encoding);
}

function artifactKindFor(osName, ext) {
  const normalizedExt = ext.toLowerCase();
  if (osName === 'macos' && normalizedExt === '.zip') return 'update';
  return 'installer';
}

function contentTypeFor(ext) {
  switch (ext.toLowerCase()) {
    case '.zip':
      return 'application/zip';
    case '.dmg':
      return 'application/x-apple-diskimage';
    case '.exe':
      return 'application/vnd.microsoft.portable-executable';
    case '.deb':
      return 'application/vnd.debian.binary-package';
    case '.rpm':
      return 'application/x-rpm';
    default:
      return 'application/octet-stream';
  }
}

async function uploadJson(client, bucket, key, value, cacheControl) {
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: JSON.stringify(value, null, 2),
    ContentType: 'application/json; charset=utf-8',
    CacheControl: cacheControl,
  }));
  console.log(`Uploaded ${key}`);
}
