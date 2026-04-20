# Async Email Classification Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show emails in the dashboard instantly as they arrive, with a "Classifying..." badge that updates silently when GPU classification completes (~1.6s later).

**Architecture:** When an email arrives, store it and broadcast to UI immediately — don't wait for classification. Classifier runs in background and broadcasts a `classification_done` SSE event when done. Dashboard listens for this event and refreshes the email list panel via HTMX. Unclassified emails show a pulsing "Classifying..." badge using a LEFT JOIN null check.

**Tech Stack:** Node.js EventEmitter pattern (setBroadcast like imap.js does), HTMX panel refresh, CSS animation for pending badge.

---

## Task 1: Add broadcast callback to classifier.js

**Files:**
- Modify: `I:\xgen-intel\intellimail\src\classifier.js`

**Step 1: Add `setBroadcast` and broadcast after classification**

In `classifier.js`, after the existing `const LOCAL_API` line, add:

```js
let broadcast = () => {};
function setBroadcast(fn) { broadcast = fn; }
```

In `storeClassification(emailId, data)`, after the `db.prepare(...).run(...)` call (line ~181) and before the draft insertion block, add:

```js
    broadcast('classification_done', {
      email_id: emailId,
      category: data.category,
      urgency:  data.urgency
    });
```

At the bottom, update `module.exports` to include `setBroadcast`:

```js
module.exports = { queueClassification, classifyAllUnclassified, classifyEmail, generateDraft, setBroadcast };
```

**Step 2: Verify the change compiles**

Run: `node -e "require('./src/classifier.js'); console.log('OK')"`
Expected: `OK`

---

## Task 2: Wire classifier broadcast in server.js

**Files:**
- Modify: `I:\xgen-intel\intellimail\src\server.js`

**Step 1: Read current server.js and find the init function**

The file imports classifier and calls `classifyAllUnclassified()` in init.

Add `setBroadcast` to the classifier import:
```js
const { classifyAllUnclassified, setBroadcast: setClassifierBroadcast } = require('./classifier');
```

In the `init()` function, alongside `setBroadcast(broadcast)` for IMAP (around line 56-61), add:
```js
setClassifierBroadcast(broadcast);
```

**Step 2: Verify**

Run: `node -e "require('./src/server.js'); console.log('OK')"`
Expected: `OK` (no import errors)

---

## Task 3: Show "Classifying..." badge for unclassified emails

**Files:**
- Modify: `I:\xgen-intel\intellimail\src\routes\api.js`

**Step 1: Find the email list rendering**

Around line 293 in the email list route:
```js
const cat = email.category || 'other';
```

Change to:
```js
const cat = email.category || 'pending';
```

**Step 2: Update `categoryLabel` function**

Find `categoryLabel` function (around line 54). Add `pending` case:
```js
function categoryLabel(cat) {
  const labels = {
    meeting_request: 'Meeting',
    financial:       'Financial',
    legal:           'Legal',
    travel:          'Travel',
    pitch_deck:      'Pitch',
    fyi:             'FYI',
    rewards_awards:  'Rewards',
    other:           'Other',
    pending:         'Classifying...',   // ← add this
  };
  return labels[cat] || 'Other';
}
```

**Step 3: Add email_id data attribute to email list rows**

In the email list HTML rendering (around line 293-320), find the email row container div. It likely looks like:
```html
<div class="email-item ..." hx-get="/api/emails/${email.id}/detail" ...>
```

Add a `data-email-id` attribute:
```html
<div class="email-item ..." data-email-id="${email.id}" hx-get="/api/emails/${email.id}/detail" ...>
```

This lets the frontend find and update individual rows.

**Step 4: Verify**

Run: `node -e "require('./src/routes/api.js'); console.log('OK')"`
Expected: `OK`

---

## Task 4: Add "Classifying..." badge CSS style

**Files:**
- Modify: `I:\xgen-intel\intellimail\public\css\app.css`

**Step 1: Find existing badge styles**

Search for `.badge-other` or `.badge-fyi` in `app.css`.

**Step 2: Add pending badge after the existing badge styles**

```css
.badge-pending {
  background: rgba(148, 163, 184, 0.15);
  color: #94a3b8;
  border: 1px solid rgba(148, 163, 184, 0.3);
  animation: pulse-pending 1.5s ease-in-out infinite;
}

@keyframes pulse-pending {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.4; }
}
```

---

## Task 5: Dashboard SSE handler for classification_done

**Files:**
- Modify: `I:\xgen-intel\intellimail\public\js\app.js`

**Step 1: Find the existing SSE event handler**

Search for `new_email` or `EventSource` in `app.js`. The existing SSE handling looks something like:
```js
source.addEventListener('new_email', (e) => { ... });
```

**Step 2: Add `classification_done` handler**

After the existing `new_email` handler, add:

```js
source.addEventListener('classification_done', (e) => {
  const data = JSON.parse(e.data);
  // Refresh the email list panel so the pending badge updates
  const listPanel = document.querySelector('.email-list-panel, [id*="email-list"], #email-list');
  if (listPanel) {
    htmx.trigger(listPanel, 'refresh');
  } else {
    // Fallback: find any HTMX element that loads the email list and trigger it
    const emailList = document.querySelector('[hx-get*="/api/emails"]');
    if (emailList) htmx.trigger(emailList, 'refresh');
  }
});
```

**Step 3: Also ensure the email list responds to 'refresh' trigger**

In `views/dashboard.html`, find the email list panel element (the div with `hx-get="/api/emails"`). Add `hx-trigger` if not already present:

Check if it already has something like `hx-trigger="load, categoryChange, refresh from:body"`. If it doesn't include `refresh`, add it to the trigger list.

---

## Task 6: Deploy to staging and test

**Step 1: Deploy files to staging server**

```python
import paramiko, sys
sys.stdout.reconfigure(encoding='utf-8')

ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('10.11.13.237', username='root', password='Digl!@#$Data321', timeout=30)

sftp = ssh.open_sftp()
base_local  = r'I:\xgen-intel\intellimail'
base_remote = '/home/AjayData/xgen-intel/intellimail'

files = [
    'src/classifier.js',
    'src/server.js',
    'src/routes/api.js',
    'public/css/app.css',
    'public/js/app.js',
]
for f in files:
    sftp.put(f'{base_local}/{f}'.replace('/', '\\'), f'{base_remote}/{f}')
    print(f'  uploaded {f}')

sftp.close()

# Restart PM2
_, out, err = ssh.exec_command('pm2 restart intellimail && echo restarted', timeout=15)
print(out.read().decode())
ssh.close()
```

**Step 2: Verify SSE events fire**

Open the dashboard in browser at `http://10.11.13.237:3099`.

In browser DevTools → Network → filter by `text/event-stream` → watch the SSE stream.

Send a test classification via staging terminal:
```bash
curl -s -X POST http://10.11.13.179:8765/classify \
  -H "Content-Type: application/json" \
  -d '{"subject":"Test email","from_address":"test@test.com","preview":"hello","email_id":"999"}'
```

Expected: `classification_done` event appears in the SSE stream after the LLM responds.

**Step 3: End-to-end test**

1. Open dashboard
2. Send yourself an email to the connected mailbox
3. Email should appear in list within seconds with "Classifying..." pulsing badge
4. 1-2 seconds later badge should update to correct category (financial/travel/etc.)

Expected: Total perceived time from email arrival to appearing in list = < 1 second.
