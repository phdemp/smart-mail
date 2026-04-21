// Run from: /home/AjayData/xgen-intel/intellimail
// node test_async_local.js
const { db } = require('./src/db');
const { queueClassification } = require('./src/classifier');

// Clean up any previous test
db.prepare("DELETE FROM classifications WHERE email_id IN (SELECT id FROM emails WHERE message_id LIKE 'test-async-%')").run();
db.prepare("DELETE FROM emails WHERE message_id LIKE 'test-async-%'").run();

// Insert test email with NO classification
const r = db.prepare(`
  INSERT INTO emails (message_id, uid, folder, from_address, from_name, to_address, subject, body_text, received_at, is_read)
  VALUES (?, ?, 'INBOX', ?, ?, '', ?, ?, datetime('now'), 0)
`).run(
  'test-async-' + Date.now(),
  String(Date.now()),
  'cfo@bigcompany.com',
  'Raj Sharma',
  'Q3 Invoice INV-2026-089 Amount Due Rs 45000',
  'Invoice for Q3 services. Amount due Rs 45000 by March 20. GST included.'
);

const emailId = r.lastInsertRowid;
console.log('Inserted email ID:', emailId);
console.log('Classification status: PENDING (no classification row yet)');

// Verify no classification exists yet
const before = db.prepare('SELECT * FROM classifications WHERE email_id = ?').get(emailId);
console.log('Classification before queue:', before ? 'EXISTS' : 'NONE (correct)');

// Queue for classification (async — returns immediately)
queueClassification(emailId);
console.log('Queued for classification — GPU will classify in ~1.6s');
console.log('');

// Poll for result every 500ms for up to 15s
let attempts = 0;
const interval = setInterval(() => {
  attempts++;
  const cls = db.prepare('SELECT * FROM classifications WHERE email_id = ?').get(emailId);
  if (cls) {
    console.log('Classification DONE after', attempts * 0.5, 'seconds:');
    console.log('  category:', cls.category);
    console.log('  urgency:', cls.urgency);
    console.log('  summary:', cls.summary);
    clearInterval(interval);
    setTimeout(() => process.exit(0), 500);
  } else if (attempts >= 30) {
    console.log('Timeout — still not classified after 15s');
    clearInterval(interval);
    process.exit(1);
  } else {
    process.stdout.write('.');
  }
}, 500);
