// PostToolUse hook for Edit|Write: lints the edited file and typechecks its package.
// Exit 2 hands the output back to the agent so it fixes the problem in the same turn.
// Node rather than shell, so it behaves the same on Windows and Linux.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
const input = JSON.parse(readFileSync(0, 'utf8'));
if (typeof input.tool_input?.file_path !== 'string') process.exit(0);

const file = path.resolve(root, input.tool_input.file_path);
const toRepoPath = (p) => path.relative(root, p).split(path.sep).join('/');
const isInsideRepo = (p) => {
  const relative = path.relative(root, p);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

const repoPath = toRepoPath(file);
const isSource = /^(apps|packages)\/.+\.(ts|vue)$/.test(repoPath);
const isGenerated = /(^|\/)(node_modules|dist)\//.test(repoPath);
if (!isSource || isGenerated || !existsSync(file)) process.exit(0);

const eslintBin = path.join(root, 'node_modules/eslint/bin/eslint.js');
if (!existsSync(eslintBin)) {
  process.stderr.write('Cannot check the edit: dependencies are missing. Run `npm ci`.');
  process.exit(2);
}

const failures = [];

const eslint = spawnSync(
  process.execPath,
  [eslintBin, '--max-warnings', '0', '--no-warn-ignored', file],
  { cwd: root, encoding: 'utf8' },
);
if (eslint.status !== 0) {
  failures.push(`eslint ${repoPath}\n${eslint.stdout}${eslint.stderr}${eslint.error ?? ''}`);
}

// The owning package is the nearest folder with a package.json, strictly inside the repo.
// Stopping at the repo boundary means a file written before its package.json never
// triggers the root typecheck, which would check every workspace on one edit.
let packageDir = path.dirname(file);
while (isInsideRepo(packageDir) && !existsSync(path.join(packageDir, 'package.json'))) {
  packageDir = path.dirname(packageDir);
}
if (isInsideRepo(packageDir)) {
  // A shell finds npm.cmd on Windows. The command is a fixed string, never built from input.
  const typecheck = spawnSync('npm run typecheck --if-present --silent', {
    cwd: packageDir,
    encoding: 'utf8',
    shell: true,
  });
  if (typecheck.status !== 0) {
    failures.push(
      `typecheck ${toRepoPath(packageDir)}\n${typecheck.stdout}${typecheck.stderr}${typecheck.error ?? ''}`,
    );
  }
}

if (failures.length > 0) {
  process.stderr.write(failures.join('\n'));
  process.exit(2);
}
