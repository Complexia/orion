import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const testHome = await fs.mkdtemp(path.join(os.tmpdir(), 'orion-skills-test-'));
process.env.HOME = testHome;

const {
  disabledSkillsDirectory,
  installSkillFrom,
  locateSkillDirectory,
  skillPickerOptions,
  skillsDirectory,
} = await import('../src/main/skills.js');
const { app } = await import('electron');

const writeSkill = async (directory, name, marker) => {
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, 'SKILL.md'), `---\nname: ${name}\n---\n${marker}\n`);
};

try {
  const originalSource = path.join(testHome, 'sources', 'original');
  await writeSkill(originalSource, 'replace-me', 'original');
  const firstInstall = await installSkillFrom(originalSource, { overwriteAll: true });
  assert.equal(firstInstall.result.status, 'imported');

  const installedFile = path.join(skillsDirectory(), 'replace-me', 'SKILL.md');
  const brokenSource = path.join(testHome, 'sources', 'broken');
  await writeSkill(brokenSource, 'replace-me', 'broken');
  await fs.symlink(path.join(brokenSource, 'missing-target'), path.join(brokenSource, 'broken-link'));
  const failedReplacement = await installSkillFrom(brokenSource, { overwriteAll: true });
  assert.equal(failedReplacement.result.status, 'error');
  assert.match(await fs.readFile(installedFile, 'utf-8'), /original/);
  assert.equal(
    (await fs.readdir(skillsDirectory())).some((entry) => entry.startsWith('.orion-skill-import-')),
    false,
    'a failed staged copy should leave the installed skill intact and clean up partial data'
  );

  const replacementSource = path.join(testHome, 'sources', 'replacement');
  await writeSkill(replacementSource, 'replace-me', 'replacement');
  const replacement = await installSkillFrom(replacementSource, { overwriteAll: true });
  assert.equal(replacement.result.status, 'replaced');
  assert.match(await fs.readFile(installedFile, 'utf-8'), /replacement/);

  const disabledReplacementSource = path.join(testHome, 'sources', 'disabled-replacement');
  const disabledTarget = path.join(disabledSkillsDirectory(), 'replace-disabled');
  await writeSkill(disabledTarget, 'replace-disabled', 'disabled-original');
  await writeSkill(disabledReplacementSource, 'replace-disabled', 'enabled-replacement');
  const disabledReplacement = await installSkillFrom(disabledReplacementSource, { overwriteAll: true });
  assert.equal(disabledReplacement.result.status, 'replaced');
  assert.equal(await fs.stat(disabledTarget).catch(() => null), null);
  assert.match(
    await fs.readFile(path.join(skillsDirectory(), 'replace-disabled', 'SKILL.md'), 'utf-8'),
    /enabled-replacement/
  );

  const duplicateActive = path.join(skillsDirectory(), 'duplicate');
  const duplicateDisabled = path.join(disabledSkillsDirectory(), 'duplicate');
  await writeSkill(duplicateActive, 'duplicate', 'active');
  await writeSkill(duplicateDisabled, 'duplicate', 'disabled');
  assert.deepEqual(
    await locateSkillDirectory({ id: 'duplicate', skillPath: duplicateActive, enabled: true }),
    { directory: duplicateActive, enabled: true }
  );
  assert.deepEqual(
    await locateSkillDirectory({ id: 'duplicate', skillPath: duplicateDisabled, enabled: false }),
    { directory: duplicateDisabled, enabled: false }
  );
  assert.equal(
    await locateSkillDirectory({ id: 'duplicate', skillPath: duplicateDisabled, enabled: true }),
    null,
    'a row path must not resolve to the same id in the other managed root'
  );
  assert.equal(
    await locateSkillDirectory({ id: 'duplicate' }),
    null,
    'an ambiguous legacy request must not fall back to the active directory'
  );

  const linuxFiles = skillPickerOptions('linux', 'file');
  const linuxDirectory = skillPickerOptions('linux', 'directory');
  assert.deepEqual(linuxFiles.properties, ['openFile', 'multiSelections']);
  assert.deepEqual(linuxDirectory.properties, ['openDirectory', 'multiSelections']);
  assert.equal(linuxFiles.properties.includes('openDirectory'), false);
  assert.equal(linuxDirectory.properties.includes('openFile'), false);

  console.log('Skill management regression checks passed.');
} finally {
  await fs.rm(testHome, { recursive: true, force: true });
  app.quit();
}
