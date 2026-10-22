import { createHmac, randomInt, randomBytes, timingSafeEqual } from 'node:crypto';
import nodemailer from 'nodemailer';
import {emailConfig} from './emailconfig.mjs';

// Codes are never returned to the browser or written to logs.
export function resetMailer(env = emailConfig()) {
  if (!env.ACCOUNT_SMTP_USER || !env.ACCOUNT_SMTP_PASSWORD) return null;
  const port = Number(env.ACCOUNT_SMTP_PORT || 465);
  const transport = nodemailer.createTransport({
    host: env.ACCOUNT_SMTP_HOST || 'smtp.hostinger.com', port, secure: port === 465,
    requireTLS: true, auth: { user: env.ACCOUNT_SMTP_USER, pass: env.ACCOUNT_SMTP_PASSWORD },
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
    disableFileAccess: true, disableUrlAccess: true,
  });
  return async (email, code) => {
    await transport.sendMail({ from: env.ACCOUNT_EMAIL_FROM || env.ACCOUNT_SMTP_USER,
      to: email, subject: 'Your KRYX password reset code',
      text: `Your KRYX password reset code is ${code}.\n\nIt expires in 10 minutes. If you did not request this, ignore this email. Never share this code.` });
  };
}

export function createPasswordReset(pool, { send = resetMailer(), secret = emailConfig().ACCOUNT_RESET_SECRET, passwordRecord, revoke } = {}) {
  const ready = pool.query(`CREATE TABLE IF NOT EXISTS password_resets (
    user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    digest TEXT NOT NULL, nonce TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );`);
  const enabled = !!send && typeof secret === 'string' && secret.length >= 32;
  const digest = (id, nonce, code) => createHmac('sha256', secret).update(`${id}:${nonce}:${code}`).digest('hex');
  return { ready, enabled,
    async request(email) {
      await ready;
      const user = (await pool.query('SELECT id,email FROM users WHERE email=$1', [email])).rows[0];
      if (!user) return;
      const code = String(randomInt(0, 10000)).padStart(4, '0'), nonce = randomBytes(24).toString('hex');
      // A new code cannot reset the guess budget more than once per ten minutes.
      const inserted = await pool.query(`INSERT INTO password_resets(user_id,digest,nonce,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL '10 minutes')
        ON CONFLICT(user_id) DO UPDATE SET digest=EXCLUDED.digest,nonce=EXCLUDED.nonce,expires_at=EXCLUDED.expires_at,attempts=0,requested_at=NOW()
        WHERE password_resets.requested_at < NOW()-INTERVAL '10 minutes' RETURNING user_id`, [user.id, digest(user.id, nonce, code), nonce]);
      if (!inserted.rows.length) return;
      try { await send(user.email, code, nonce); }
      catch (error) {
        await pool.query('DELETE FROM password_resets WHERE user_id=$1 AND nonce=$2', [user.id, nonce]);
        // Keep the public response identical for registered and unknown addresses.
        console.error('[password reset] Email provider rejected or timed out. Check server email configuration.');
      }
    },
    async confirm(email, code, password) {
      await ready;
      const client = await pool.connect();
      let sessions = [];
      try {
        await client.query('BEGIN');
        const row = (await client.query(`SELECT r.*,u.email FROM password_resets r JOIN users u ON u.id=r.user_id WHERE u.email=$1 FOR UPDATE OF r`, [email])).rows[0];
        if (!row || new Date(row.expires_at).getTime() <= Date.now() || row.attempts >= 5) { await client.query('ROLLBACK'); return false; }
        const actual=Buffer.from(digest(row.user_id,row.nonce,code),'hex'),expected=Buffer.from(row.digest,'hex');
        if (actual.length!==expected.length || !timingSafeEqual(actual,expected)) {
          await client.query('UPDATE password_resets SET attempts=attempts+1 WHERE user_id=$1', [row.user_id]);
          await client.query('COMMIT'); return false;
        }
        const record = await passwordRecord(password);
        await client.query('UPDATE users SET password_hash=$1,password_salt=$2 WHERE id=$3', [record.hash, record.salt, row.user_id]);
        sessions = (await client.query('DELETE FROM account_sessions WHERE user_id=$1 RETURNING token_hash', [row.user_id])).rows;
        // Retain the cooldown after use so replay/resend cannot mint another code.
        await client.query('UPDATE password_resets SET attempts=5,expires_at=NOW() WHERE user_id=$1', [row.user_id]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
      for (const session of sessions) revoke?.(session.token_hash);
      return true;
    },
  };
}
