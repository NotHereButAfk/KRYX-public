import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function eligible(event, repository) {
  const run = event?.workflow_run;
  return repository === 'NotHereButAfk/Ev.io' && run?.head_repository?.full_name === repository
    && run.head_branch === 'main' && run.event === 'push' && run.conclusion === 'success'
    && run.name === 'Deploy to VPS';
}

export function message(note) {
  if (!note || !/^[a-z0-9-]{1,80}$/.test(note.id) || typeof note.title !== 'string'
      || !note.title.trim() || note.title.length > 120 || !Array.isArray(note.changes)
      || note.changes.length < 1 || note.changes.length > 12
      || note.changes.some(x => typeof x !== 'string' || !x.trim() || x.length > 250)) {
    throw Error('Invalid game release note');
  }
  const clean = s => s.replace(/[\r\n]/g, ' ').replace(/@/g, '@\u200b');
  const content = `**KRYX update: ${clean(note.title)}**\n${note.changes.map(x => `• ${clean(x)}`).join('\n')}\n\nPlay: https://kryx.live`;
  if (content.length > 1900) throw Error('Release note is too long');
  return { username: 'KRYX Updates', content, allowed_mentions: { parse: [] } };
}

export async function announce(note, env, request = fetch) {
  const payload = message(note);
  const name = 'discord-notice-' + createHash('sha256').update(note.id).digest('hex').slice(0, 32);
  if (env.DRY_RUN === '1') return { status: 'preview', payload, name };
  if (env.GITHUB_REPOSITORY !== 'NotHereButAfk/Ev.io' || !env.GITHUB_TOKEN) throw Error('Primary repository credentials required');
  let webhook;
  try { webhook = new URL(env.DISCORD_UPDATES_WEBHOOK_URL); } catch { throw Error('Configure DISCORD_UPDATES_WEBHOOK_URL'); }
  if (webhook.origin !== 'https://discord.com' || webhook.username || webhook.password
      || !/^\/api(?:\/v10)?\/webhooks\/\d{17,24}\/[A-Za-z0-9_-]+$/.test(webhook.pathname)
      || webhook.search || webhook.hash) throw Error('Use a Discord text-channel webhook URL');
  const prior = await request(`https://api.github.com/repos/NotHereButAfk/Ev.io/actions/artifacts?name=${name}&per_page=100`, {
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  if (!prior.ok) throw Error(`Receipt lookup failed (${prior.status}); no message sent`);
  const records = await prior.json();
  if (!Array.isArray(records.artifacts)) throw Error('Invalid receipt lookup');
  if (records.artifacts.some(x => x.name === name && !x.expired && x.workflow_run?.head_branch === 'main')) {
    return { status: 'already-sent', name };
  }
  webhook.searchParams.set('wait', 'true');
  const response = await request(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Error(`Discord rejected update (${response.status}); inspect before retrying`);
  const posted = await response.json();
  if (!/^\d{17,24}$/.test(posted.id || '')) throw Error('Discord acknowledgement missing; inspect channel before retrying');
  return { status: 'sent', name, receipt: { releaseId: note.id, messageId: posted.id } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.DRY_RUN !== '1') {
      const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
      if (process.env.GITHUB_EVENT_NAME !== 'workflow_run' || !eligible(event, process.env.GITHUB_REPOSITORY)) {
        throw Error('Only successful main deployments can announce');
      }
    }
    const note = JSON.parse(await readFile('release/game-update.json', 'utf8'));
    const result = await announce(note, process.env);
    if (result.status === 'preview') console.log(JSON.stringify(result.payload, null, 2));
    else console.log(`Discord update: ${result.status}`);
    if (result.receipt) await writeFile('discord-receipt.json', JSON.stringify(result.receipt));
    if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT,
      `sent=${result.status === 'sent'}\nreceipt_name=${result.name}\n`);
  } catch {
    // Fetch errors can embed the credential-bearing URL. Never print them.
    console.error('Discord announcement failed. Check secret configuration, release notes and channel before rerunning.');
    process.exitCode = 1;
  }
}
