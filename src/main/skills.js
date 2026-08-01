import { dialog, shell } from 'electron';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFileAsync } from './shell-env.js';

// Agent skills are plain directories under ~/.claude/skills, each holding a
// SKILL.md with YAML frontmatter. Every provider that reads Claude's user
// settings (the Claude SDK driver passes settingSources: ['user', ...])
// discovers them by listing that directory, so "deactivate" moves the
// directory into a sibling folder nothing scans rather than writing extra
// state we would then have to keep in sync with the filesystem.
const claudeHomeDirectory = () => path.join(os.homedir(), '.claude');
export const skillsDirectory = () => path.join(claudeHomeDirectory(), 'skills');
export const disabledSkillsDirectory = () => path.join(claudeHomeDirectory(), 'skills-disabled');

const skillFileName = 'SKILL.md';
const archiveExtensions = new Set(['.zip']);
// Skills are small; these caps only stop a mis-picked folder (a repo, a home
// directory) from being walked or copied wholesale.
const maxTreeEntries = 5000;
const maxSearchDepth = 3;

const pathExists = async (target) => {
  try {
    await fs.stat(target);
    return true;
  } catch {
    return false;
  }
};

const isDirectory = async (target) => {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
};

/** Directory names only — never a path segment that could escape the roots. */
const isSafeSkillId = (id) =>
  typeof id === 'string' && id.length > 0 && id !== '.' && id !== '..' && /^[A-Za-z0-9._-]+$/.test(id);

const sanitizeSkillId = (value) => {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64);
  return isSafeSkillId(slug) ? slug : '';
};

const unquote = (value) => {
  const trimmed = String(value).trim();
  if (trimmed.length >= 2 && /^(['"]).*\1$/s.test(trimmed)) return trimmed.slice(1, -1);
  return trimmed;
};

// Deliberately minimal: SKILL.md frontmatter is a flat map of scalars, and we
// only need name/description/version to render a row. Anything exotic falls
// back to the directory name.
export const parseSkillFrontmatter = (text) => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || ''));
  if (!match) return {};
  const fields = {};
  let key = null;
  let blockStyle = null;
  for (const line of match[1].split(/\r?\n/)) {
    if (key && blockStyle && (line.trim() === '' || /^\s/.test(line))) {
      const piece = line.trim();
      fields[key] = fields[key] ? `${fields[key]}${blockStyle === '|' ? '\n' : ' '}${piece}` : piece;
      continue;
    }
    const entry = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (entry) {
      key = entry[1];
      const value = entry[2].trim();
      if (value === '|' || value === '>' || value === '|-' || value === '>-' || value === '|+' || value === '>+') {
        blockStyle = value[0];
        fields[key] = '';
      } else {
        blockStyle = null;
        fields[key] = unquote(value);
      }
      continue;
    }
    // Wrapped continuation of a plain scalar.
    if (key && !blockStyle && /^\s+\S/.test(line)) {
      fields[key] = `${fields[key]} ${line.trim()}`.trim();
    }
  }
  return fields;
};

const measureTree = async (root) => {
  let bytes = 0;
  let files = 0;
  const walk = async (dir, depth) => {
    if (files >= maxTreeEntries || depth > 6) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files >= maxTreeEntries) return;
      const child = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(child, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      files += 1;
      try {
        bytes += (await fs.stat(child)).size;
      } catch {
        // A file that vanished mid-walk just doesn't count toward the total.
      }
    }
  };
  await walk(root, 0);
  return { bytes, files };
};

const readSkillAt = async (directory, enabled) => {
  let raw;
  try {
    raw = await fs.readFile(path.join(directory, skillFileName), 'utf-8');
  } catch {
    return null;
  }
  const fields = parseSkillFrontmatter(raw);
  const stats = await fs.stat(directory).catch(() => null);
  const { bytes, files } = await measureTree(directory);
  const id = path.basename(directory);
  return {
    id,
    name: String(fields.name || id).trim() || id,
    description: String(fields.description || '').trim(),
    version: fields.version ? String(fields.version) : null,
    license: fields.license ? String(fields.license) : null,
    path: directory,
    // Handed to the renderer so opening a skill in the Code tab doesn't have
    // to join paths itself.
    skillFile: path.join(directory, skillFileName),
    enabled,
    scope: 'user',
    bytes,
    files,
    updatedAt: stats?.mtime ? stats.mtime.toISOString() : null,
  };
};

const readSkillsIn = async (root, enabled) => {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const skills = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const directory = path.join(root, entry.name);
    // Symlinked skill directories are common for skills developed elsewhere.
    if (!entry.isDirectory() && !(entry.isSymbolicLink() && (await isDirectory(directory)))) continue;
    const skill = await readSkillAt(directory, enabled);
    if (skill) skills.push(skill);
  }
  return skills;
};

export const listSkills = async () => {
  try {
    const [active, inactive] = await Promise.all([
      readSkillsIn(skillsDirectory(), true),
      readSkillsIn(disabledSkillsDirectory(), false),
    ]);
    const skills = [...active, ...inactive].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    );
    return {
      ok: true,
      skills,
      skillsPath: skillsDirectory(),
      disabledPath: disabledSkillsDirectory(),
    };
  } catch (error) {
    return {
      ok: false,
      skills: [],
      skillsPath: skillsDirectory(),
      disabledPath: disabledSkillsDirectory(),
      error: error?.message || String(error),
    };
  }
};

export const locateSkillDirectory = async ({ id, skillPath, enabled }) => {
  if (!isSafeSkillId(id)) return null;
  if (typeof skillPath === 'string') {
    const resolved = path.resolve(skillPath);
    const candidates = [
      { directory: path.join(skillsDirectory(), id), enabled: true },
      { directory: path.join(disabledSkillsDirectory(), id), enabled: false },
    ];
    const exact = candidates.find(
      (candidate) =>
        path.resolve(candidate.directory) === resolved &&
        (typeof enabled !== 'boolean' || candidate.enabled === enabled)
    );
    if (!exact || !(await pathExists(exact.directory))) return null;
    return exact;
  }
  if (typeof enabled === 'boolean') {
    const expected = path.join(enabled === false ? disabledSkillsDirectory() : skillsDirectory(), id);
    if (await pathExists(expected)) return { directory: expected, enabled: enabled !== false };
  }
  // Never guess active-first: duplicate IDs can legitimately exist after a
  // manual filesystem move, and guessing can delete or reveal the wrong row.
  return null;
};

const movePath = async (from, to) => {
  await fs.mkdir(path.dirname(to), { recursive: true });
  try {
    await fs.rename(from, to);
  } catch (error) {
    // Both roots live under ~/.claude, so EXDEV only happens when a skill was
    // installed on another volume and symlinked/bind-mounted in.
    if (error?.code !== 'EXDEV') throw error;
    await fs.cp(from, to, { recursive: true });
    await fs.rm(from, { recursive: true, force: true });
  }
};

export const setSkillEnabled = async ({ id, enabled }) => {
  if (!isSafeSkillId(id)) return { ok: false, error: 'Invalid skill name.' };
  const want = enabled !== false;
  const from = path.join(want ? disabledSkillsDirectory() : skillsDirectory(), id);
  const to = path.join(want ? skillsDirectory() : disabledSkillsDirectory(), id);
  try {
    if (!(await pathExists(from))) {
      // Already in the requested state is a success, not an error.
      if (await pathExists(to)) return { ok: true };
      return { ok: false, error: `"${id}" is no longer installed.` };
    }
    if (await pathExists(to)) {
      return {
        ok: false,
        error: `Another skill folder named "${id}" already exists in ${path.dirname(to)}.`,
      };
    }
    await movePath(from, to);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
};

export const deleteSkill = async ({ window, id, skillPath, enabled, confirm = true }) => {
  if (!isSafeSkillId(id)) return { ok: false, error: 'Invalid skill name.' };
  const located = await locateSkillDirectory({ id, skillPath, enabled });
  if (!located) return { ok: false, error: `"${id}" is no longer installed.` };

  if (confirm) {
    const options = {
      type: 'warning',
      buttons: ['Delete', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: `Delete the "${id}" skill?`,
      detail: `${located.directory}\n\nThe folder is moved to the Trash.`,
    };
    const { response } = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options);
    if (response !== 0) return { ok: true, cancelled: true };
  }

  try {
    await shell.trashItem(located.directory);
  } catch {
    // Trash can be unavailable (no Finder session, a network volume) — the
    // user asked for the skill to be gone either way.
    try {
      await fs.rm(located.directory, { recursive: true, force: true });
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }
  return { ok: true };
};

export const revealSkill = async ({ id, skillPath, enabled }) => {
  const located = await locateSkillDirectory({ id, skillPath, enabled });
  if (!located) return { ok: false, error: `"${id}" is no longer installed.` };
  const skillFile = path.join(located.directory, skillFileName);
  shell.showItemInFolder((await pathExists(skillFile)) ? skillFile : located.directory);
  return { ok: true };
};

export const openSkillsFolder = async () => {
  const target = skillsDirectory();
  await fs.mkdir(target, { recursive: true });
  const error = await shell.openPath(target);
  return error ? { ok: false, error } : { ok: true };
};

const hasSkillFile = async (directory) => pathExists(path.join(directory, skillFileName));

/**
 * A picked folder can be a skill, a pack of skills, or a repo that holds one
 * somewhere shallow — collect every skill root without descending forever.
 */
const collectSkillSources = async (directory, depth = 0) => {
  if (await hasSkillFile(directory)) return [directory];
  if (depth >= maxSearchDepth) return [];
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    found.push(...(await collectSkillSources(path.join(directory, entry.name), depth + 1)));
  }
  return found;
};

const extractArchive = async (archivePath) => {
  const workingDir = await fs.mkdtemp(path.join(os.tmpdir(), 'orion-skill-'));
  if (process.platform === 'win32') {
    await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        'Expand-Archive -LiteralPath $env:ORION_SKILL_ARCHIVE -DestinationPath $env:ORION_SKILL_DEST -Force',
      ],
      {
        timeout: 60000,
        env: {
          ...process.env,
          ORION_SKILL_ARCHIVE: archivePath,
          ORION_SKILL_DEST: workingDir,
        },
      }
    );
  } else {
    await execFileAsync('unzip', ['-q', '-o', archivePath, '-d', workingDir], { timeout: 60000 });
  }
  // Zips made in Finder carry a __MACOSX sidecar that looks like a tree of
  // skills to the collector.
  await fs.rm(path.join(workingDir, '__MACOSX'), { recursive: true, force: true });
  return workingDir;
};

const isInsideManagedRoots = (target) => {
  const resolved = path.resolve(target);
  return [skillsDirectory(), disabledSkillsDirectory()].some(
    (root) => resolved === root || resolved.startsWith(`${root}${path.sep}`)
  );
};

export const installSkillFrom = async (sourceDirectory, { window, overwriteAll }) => {
  const raw = await fs.readFile(path.join(sourceDirectory, skillFileName), 'utf-8').catch(() => '');
  const fields = parseSkillFrontmatter(raw);
  const fallbackName = path.basename(sourceDirectory);
  const id = sanitizeSkillId(fields.name) || sanitizeSkillId(fallbackName);
  if (!id) {
    return {
      result: { id: fallbackName, name: fallbackName, status: 'error', error: 'Could not derive a skill folder name.' },
      overwriteAll,
    };
  }
  const name = String(fields.name || id).trim() || id;

  if (isInsideManagedRoots(sourceDirectory)) {
    return { result: { id, name, status: 'skipped', error: 'Already installed.' }, overwriteAll };
  }

  const enabledTarget = path.join(skillsDirectory(), id);
  const disabledTarget = path.join(disabledSkillsDirectory(), id);
  const existing = (await pathExists(enabledTarget))
    ? enabledTarget
    : (await pathExists(disabledTarget))
      ? disabledTarget
      : null;

  let nextOverwriteAll = overwriteAll;
  if (existing && !overwriteAll) {
    const options = {
      type: 'question',
      buttons: ['Replace', 'Skip'],
      defaultId: 1,
      cancelId: 1,
      message: `"${id}" is already installed.`,
      detail: `${existing}\n\nReplace it with the version you are importing?`,
      checkboxLabel: 'Apply to every remaining conflict',
      checkboxChecked: false,
    };
    const { response, checkboxChecked } = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options);
    if (response !== 0) {
      return { result: { id, name, status: 'skipped' }, overwriteAll: nextOverwriteAll };
    }
    if (checkboxChecked) nextOverwriteAll = true;
  }

  let stagingRoot = null;
  let backup = null;
  let preserveStaging = false;
  try {
    await fs.mkdir(skillsDirectory(), { recursive: true });
    stagingRoot = await fs.mkdtemp(path.join(skillsDirectory(), '.orion-skill-import-'));
    const stagedTarget = path.join(stagingRoot, id);
    // Finish the fallible recursive copy before touching the installed skill.
    await fs.cp(sourceDirectory, stagedTarget, { recursive: true, dereference: true });
    if (existing) {
      backup = path.join(stagingRoot, '.previous');
      await fs.rename(existing, backup);
    }
    try {
      // Staging lives beside the active root, so this final install is an
      // atomic same-volume rename. Deactivated replacements become active.
      await fs.rename(stagedTarget, enabledTarget);
    } catch (error) {
      let installError = error;
      if (backup) {
        await fs.rename(backup, existing).catch((rollbackError) => {
          preserveStaging = true;
          installError = new Error(
            `${error?.message || String(error)} (rollback failed; previous skill remains at ${backup}: ${rollbackError?.message || String(rollbackError)})`
          );
        });
      }
      throw installError;
    }
    return {
      result: { id, name, status: existing ? 'replaced' : 'imported' },
      overwriteAll: nextOverwriteAll,
    };
  } catch (error) {
    return {
      result: { id, name, status: 'error', error: error?.message || String(error) },
      overwriteAll: nextOverwriteAll,
    };
  } finally {
    if (stagingRoot && !preserveStaging) {
      await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
};

export const skillPickerOptions = (platform, kind = null) => {
  const base = {
    title: 'Import skills',
    buttonLabel: 'Import',
  };
  if (platform === 'darwin') {
    return {
      ...base,
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [{ name: 'Skills', extensions: ['md', 'zip'] }],
    };
  }
  if (kind === 'directory') return { ...base, properties: ['openDirectory', 'multiSelections'] };
  return {
    ...base,
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Skills', extensions: ['md', 'zip'] }],
  };
};

const pickSkillPaths = async (window) => {
  let kind = null;
  if (process.platform !== 'darwin') {
    const chooser = {
      type: 'question',
      buttons: ['Files or archives', 'Folder', 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'What would you like to import?',
      detail: 'Choose SKILL.md or .zip files, or choose a folder containing one or more skills.',
    };
    const { response } = window
      ? await dialog.showMessageBox(window, chooser)
      : await dialog.showMessageBox(chooser);
    if (response === 2) return null;
    kind = response === 1 ? 'directory' : 'file';
  }
  const options = skillPickerOptions(process.platform, kind);
  const picked = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  return picked.canceled || picked.filePaths.length === 0 ? null : picked.filePaths;
};

/**
 * Import skills from folders, SKILL.md files, or .zip archives. With no
 * `paths`, the user picks them; a picked SKILL.md imports its whole folder so
 * bundled references come along.
 */
export const importSkills = async ({ window, paths } = {}) => {
  let selected = Array.isArray(paths) ? paths.filter((entry) => typeof entry === 'string' && entry) : [];
  if (selected.length === 0) {
    const pickedPaths = await pickSkillPaths(window);
    if (!pickedPaths) return { ok: true, cancelled: true, results: [] };
    selected = pickedPaths;
  }

  const temporaryDirectories = [];
  const sources = [];
  const results = [];
  try {
    for (const entry of selected) {
      if (await isDirectory(entry)) {
        const found = await collectSkillSources(entry);
        if (found.length === 0) {
          results.push({
            id: path.basename(entry),
            name: path.basename(entry),
            status: 'error',
            error: 'No SKILL.md found in that folder.',
          });
          continue;
        }
        sources.push(...found);
        continue;
      }

      const extension = path.extname(entry).toLowerCase();
      if (archiveExtensions.has(extension)) {
        try {
          const extracted = await extractArchive(entry);
          temporaryDirectories.push(extracted);
          const found = await collectSkillSources(extracted);
          if (found.length === 0) {
            results.push({
              id: path.basename(entry),
              name: path.basename(entry),
              status: 'error',
              error: 'No SKILL.md found in that archive.',
            });
            continue;
          }
          sources.push(...found);
        } catch (error) {
          results.push({
            id: path.basename(entry),
            name: path.basename(entry),
            status: 'error',
            error: `Could not unpack the archive: ${error?.message || String(error)}`,
          });
        }
        continue;
      }

      if (path.basename(entry).toLowerCase() === skillFileName.toLowerCase()) {
        // Import the folder around it so references/ and scripts/ come too.
        sources.push(path.dirname(entry));
        continue;
      }

      results.push({
        id: path.basename(entry),
        name: path.basename(entry),
        status: 'error',
        error: 'Pick a skill folder, its SKILL.md, or a .zip archive.',
      });
    }

    const seen = new Set();
    let overwriteAll = false;
    for (const source of sources) {
      const key = path.resolve(source);
      if (seen.has(key)) continue;
      seen.add(key);
      const outcome = await installSkillFrom(source, { window, overwriteAll });
      overwriteAll = outcome.overwriteAll;
      results.push(outcome.result);
    }
  } finally {
    await Promise.all(
      temporaryDirectories.map((directory) => fs.rm(directory, { recursive: true, force: true }).catch(() => {}))
    );
  }

  return { ok: true, results };
};
