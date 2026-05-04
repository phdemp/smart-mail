const nodemailer = require('nodemailer');
const { getConfig } = require('./db');
const { mapAuthError } = require('./util/credentials');

async function sendEmail({ to, subject, body, replyToMessageId }) {
  const cfg = getConfig();
  if (!cfg) throw new Error('No account configuration found');

  const transporter = nodemailer.createTransport({
    host: cfg.smtp_host,
    port: cfg.smtp_port,
    secure: cfg.smtp_port === 465,
    auth: { user: cfg.username, pass: cfg.password },
    tls: { rejectUnauthorized: false, maxVersion: 'TLSv1.2', ciphers: 'DEFAULT:@SECLEVEL=0' },
    connectionTimeout: 15000
  });

  await transporter.verify();

  const mailOptions = {
    from: `${cfg.display_name} <${cfg.email}>`,
    to,
    subject,
    text: body
  };
  if (replyToMessageId) {
    mailOptions.inReplyTo = replyToMessageId;
    mailOptions.references = replyToMessageId;
  }

  const info = await transporter.sendMail(mailOptions);
  return info;
}

async function testSmtp(cfg) {
  if (!cfg) cfg = getConfig();
  if (!cfg) return { ok: false, error: 'No config' };
  try {
    const transporter = nodemailer.createTransport({
      host: cfg.smtp_host, port: cfg.smtp_port,
      secure: cfg.smtp_port === 465,
      auth: { user: cfg.username, pass: cfg.password },
      tls: { rejectUnauthorized: false, maxVersion: 'TLSv1.2', ciphers: 'DEFAULT:@SECLEVEL=0' }, connectionTimeout: 10000
    });
    await transporter.verify();
    return { ok: true };
  } catch (e) {
    // nodemailer puts the SMTP server reply directly on e.message
    // ("Invalid login: 534-5.7.9 ..."). Pass it through the auth mapper so
    // Gmail-specific failures get a friendly App Password hint.
    return { ok: false, error: mapAuthError(cfg.smtp_host, e.message) };
  }
}

module.exports = { sendEmail, testSmtp };
