// Helpers for normalizing passwords supplied during signup / connection-test
// and for translating raw IMAP/SMTP authentication failures into UX-friendly
// strings for the wizard.
//
// Why this exists: Google displays Gmail app passwords as four 4-character
// blocks separated by spaces ("abcd efgh ijkl mnop"). Users routinely paste
// the displayed format. Gmail's IMAP/SMTP servers reject the value with the
// spaces intact and the wizard surfaces an opaque error. We strip whitespace
// before authenticating; for Gmail we strip *all* internal whitespace (the
// app-password format itself never contains spaces), and for everything else
// we only trim leading/trailing whitespace so we don't mangle real passwords
// that legitimately contain spaces.

function isGmailHost(host) {
  if (!host) return false;
  const h = String(host).toLowerCase();
  return h.endsWith('gmail.com') || h.endsWith('googlemail.com');
}

function normalizePassword(host, password) {
  if (password == null) return password;
  const s = String(password);
  if (isGmailHost(host)) {
    // Gmail app passwords are 16 hex-ish chars, no whitespace ever.
    return s.replace(/\s+/g, '');
  }
  // Everything else: only trim edges. Preserve internal spaces — some users
  // legitimately have spaces inside their password.
  return s.replace(/^\s+|\s+$/g, '');
}

const APPPW_URL = 'https://myaccount.google.com/apppasswords';

// Map an authentication error from imapflow/nodemailer to a friendlier
// user-facing string. We look at multiple raw signals: nodemailer's
// "Invalid login: 535-5.7.8 ..." style strings, imapflow's `responseText`
// ("Invalid credentials (Failure)") and the generic "Application-specific
// password required" / "Username and Password not accepted" messages.
function mapAuthError(host, rawError) {
  if (!rawError) return rawError;
  const raw = String(rawError);
  const lower = raw.toLowerCase();
  const gmail = isGmailHost(host);

  // Order matters: most-specific first.
  if (lower.includes('application-specific password required')) {
    return `Gmail requires an App Password (your normal Google password won't work). Generate one at ${APPPW_URL} and paste it here.`;
  }
  if (lower.includes('webloginrequired') || lower.includes('please log in with your web browser')) {
    return `Gmail blocked this sign-in attempt. If you have 2-Step Verification on, generate an App Password at ${APPPW_URL} and use it instead of your account password.`;
  }
  if (gmail && (lower.includes('invalid credentials') || lower.includes('username and password not accepted'))) {
    return `Gmail rejected the credentials. Make sure you're using a 16-character App Password (not your Google account password) — generate one at ${APPPW_URL}.`;
  }
  if (gmail && lower.includes('command failed')) {
    // imapflow swallows Gmail's auth response into a generic "Command failed".
    // For Gmail this almost always means the password/app-password is wrong.
    return `Gmail rejected the credentials. If you have 2-Step Verification on, you must use a 16-character App Password from ${APPPW_URL}.`;
  }
  if (lower.includes('invalid credentials') || lower.includes('username and password not accepted')) {
    return 'The email server rejected the username and password. Double-check both, and use an App Password if your provider requires one.';
  }
  return raw;
}

module.exports = { normalizePassword, mapAuthError, isGmailHost };
