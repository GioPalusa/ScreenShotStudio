import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Inspect tracked publication contents. Never print potential secret values.
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const violations = [];
for (const file of files) {
  if (/^project\//.test(file) || /\.(sss|screenshotstudio)\//i.test(file) || /(?:^|\/)\.env(?:$|\.)|\.(?:p12|p8|pem|key|mobileprovision)$/i.test(file)) {
    violations.push(`${file}: private document or credential file`); continue;
  }
  if (!/\.(?:mjs|cjs|js|json|md|yml|yaml|html|css|swift|plist|entitlements|pbxproj|sh|txt)$/.test(file)) continue;
  const content = readFileSync(file, 'utf8');
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content) || /gh[pousr]_[A-Za-z0-9]{36,}/.test(content) || /AKIA[A-Z0-9]{16}/.test(content)) violations.push(`${file}: potential credential`);
}
if (violations.length) throw new Error(violations.join('\n'));
execFileSync('git', ['diff', '--check', '4b825dc642cb6eb9a060e54bf8d69288fbee4904', 'HEAD'], { stdio: 'inherit' });
console.log(`Public source check passed (${files.length} tracked files).`);
