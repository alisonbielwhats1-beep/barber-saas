/** Source-only transfer to the authorized Codespace. Never includes env, keys,
 * DB backups, generated output, deployment config, or evidence directories. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'artifacts', 'secretary-staging-candidate');
fs.mkdirSync(out, { recursive: true });
const top = new Set(['package.json', 'package-lock.json', 'next.config.mjs', 'next-env.d.ts',
  'tsconfig.json', 'tailwind.config.ts', 'postcss.config.js', 'vitest.config.ts',
  '.eslintrc.json', '.eslintignore', 'playwright.config.ts']);
const all = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0').filter(Boolean);
const files = [...new Set(all)].filter(name => top.has(name) || /^(src|public|prisma|packages|tests|scripts)\//.test(name))
  .filter(name => !/(^|\/)(node_modules|results|artifacts|\.demo|\.git|\.next|dist)(\/|$)/.test(name))
  .filter(name => !/(^|\/)\.env|\.(log|dump|pgp|pem|key|aes|db|tsbuildinfo)$/i.test(name)).sort();
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const manifest = files.map(name => {
  const file = path.resolve(root, name);
  if (!file.startsWith(root + path.sep) || !fs.lstatSync(file).isFile()) throw Error('UNSAFE_PACKAGE_PATH');
  const contents = fs.readFileSync(file);
  // Actual provider credentials must never be transferred as source.
  if (/sk-(?:proj-|svcacct-)[A-Za-z0-9_-]{40,}/.test(contents.toString('utf8'))) throw Error('CREDENTIAL_PATTERN_IN_SOURCE: ' + name);
  return { path: name, bytes: contents.length, sha256: sha(contents) };
});
const list = path.join(out, 'files.txt');
fs.writeFileSync(list, files.join('\n') + '\n');
const archive = path.join(out, 'candidate.tar.gz');
execFileSync('tar', ['-czf', archive, '-T', list], { cwd: root });
const result = {
  base_commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim(),
  branch: execFileSync('git', ['branch', '--show-current'], { cwd: root }).toString().trim(),
  includes_uncommitted_candidate: true,
  source_manifest_sha256: sha(JSON.stringify(manifest)),
  archive_sha256: sha(fs.readFileSync(archive)),
  file_count: manifest.length, archive_bytes: fs.statSync(archive).size,
  no_environment_or_credentials: true, files: manifest,
};
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ ...result, files: undefined, archive }, null, 2));
