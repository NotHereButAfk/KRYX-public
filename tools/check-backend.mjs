import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
// Isolated regression fixtures only: no production account, database or transfer.
const checks = [
  'server/listener_security_test.mjs',
  'server/accountsecurity_test.mjs',
  'server/account_authorization_test.mjs',
  'server/security_boundary_test.mjs',
  'server/security_capacity_test.mjs',
  'tools/economy_api_check.mjs',
];
for (const file of checks) {
  console.log(`\nChecking ${file}`);
  const result = spawnSync(process.execPath, [file], {
    cwd: root, stdio: 'inherit', timeout: 60_000, windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    console.error(`Backend check failed: ${file}${result.error ? ` (${result.error.code})` : ''}`);
    process.exit(result.status || 1);
  }
}
console.log('\nAll backend authorization and boundary checks passed.');
