import test from 'node:test';
import assert from 'node:assert/strict';
import { announce, message, eligible } from '../tools/discord-updates.mjs';
const note = { id: 'test-release', title: 'New arena', changes: ['Improved bots @everyone'] };
const env = { GITHUB_REPOSITORY: 'NotHereButAfk/Ev.io', GITHUB_TOKEN: 'test-only',
  DISCORD_UPDATES_WEBHOOK_URL: 'https://discord.com/api/webhooks/12345678901234567/test-only' };
const response = data => ({ ok: true, json: async () => data });
test('only successful primary main push deployments may announce', () => {
  const run = { head_repository: { full_name: env.GITHUB_REPOSITORY }, head_branch: 'main',
    event: 'push', conclusion: 'success', name: 'Deploy to VPS' };
  assert(eligible({ workflow_run: run }, env.GITHUB_REPOSITORY));
  for (const overrides of [{ event: 'pull_request' }, { event: 'workflow_dispatch' },
    { conclusion: 'failure' }, { conclusion: 'cancelled' }, { head_branch: 'feature' },
    { head_repository: { full_name: 'fork/repo' } }, { name: 'Unrelated' }]) {
    assert(!eligible({ workflow_run: { ...run, ...overrides } }, env.GITHUB_REPOSITORY));
  }
  assert(!eligible({}, env.GITHUB_REPOSITORY));
  assert(!eligible({ workflow_run: run }, 'NotHereButAfk/KRYX-public'));
});
test('bounded player-facing payload disables pings; preview makes no requests', async () => {
  assert.deepEqual(message(note).allowed_mentions, { parse: [] });
  assert(!message(note).content.includes('@everyone'));
  assert.throws(() => message({ ...note, changes: ['x'.repeat(251)] }));
  assert.throws(() => message({ ...note, id: '../bad' }));
  assert.equal((await announce(note, { DRY_RUN: '1' }, () => assert.fail('network'))).status, 'preview');
});
test('sends confirmed message and returns receipt without leaking credentials', async () => {
  let calls = 0;
  const result = await announce(note, env, async (url, options) => {
    if (++calls === 1) { assert.equal(new URL(url).hostname, 'api.github.com'); return response({ artifacts: [] }); }
    assert.equal(options.headers.Authorization, undefined);
    assert.equal(new URL(url).searchParams.get('wait'), 'true');
    assert.equal(options.redirect, 'error');
    assert.deepEqual(JSON.parse(options.body), message(note));
    return response({ id: '123456789012345678' });
  });
  assert.equal(result.status, 'sent'); assert.equal(calls, 2);
  assert(!JSON.stringify(result).includes('test-only'));
});
test('successful receipt suppresses duplicate; lookup failure prevents post', async () => {
  const { name } = await announce(note, { DRY_RUN: '1' });
  let calls = 0;
  assert.equal((await announce(note, env, async () => {
    calls++; return response({ artifacts: [{ name, expired: false, workflow_run: { head_branch: 'main' } }] });
  })).status, 'already-sent');
  assert.equal(calls, 1);
  await assert.rejects(announce(note, env, async () => ({ ok: false, status: 403 })));
});
test('rejects wrong repository and external credential destinations before network', async () => {
  for (const overrides of [{ GITHUB_REPOSITORY: 'NotHereButAfk/KRYX-public' },
    { DISCORD_UPDATES_WEBHOOK_URL: 'https://example.com/api/webhooks/12345678901234567/token' },
    { DISCORD_UPDATES_WEBHOOK_URL: env.DISCORD_UPDATES_WEBHOOK_URL + '?thread_id=1' }]) {
    await assert.rejects(announce(note, { ...env, ...overrides }, () => assert.fail('network')));
  }
});
test('rate limits and uncertain sends fail without automatic duplicate retries', async () => {
  for (const code of [429, 500]) {
    let calls = 0;
    await assert.rejects(announce(note, env, async () => ++calls === 1
      ? response({ artifacts: [] }) : { ok: false, status: code }));
    assert.equal(calls, 2);
  }
});
