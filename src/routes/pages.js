const express = require('express');
const path = require('path');
const router = express.Router();
const views = path.join(__dirname, '..', '..', 'views');

// Root: tiny HTML shell that redirects client-side based on token + user count.
router.get('/', (req, res) => {
  res.type('html').send(`<!DOCTYPE html><script>
  (function(){
    const t = localStorage.getItem('intellimail_token');
    if (t) { location.href = '/dashboard'; return; }
    fetch('/api/users/any').then(r => r.json()).then(d => {
      location.href = d.any ? '/login' : '/setup';
    }).catch(() => { location.href = '/setup'; });
  })();
  </script>`);
});

router.get('/login',     (req, res) => res.sendFile(path.join(views, 'login.html')));
router.get('/setup',     (req, res) => res.sendFile(path.join(views, 'setup.html')));
router.get('/dashboard', (req, res) => res.sendFile(path.join(views, 'dashboard.html')));
router.get('/settings',  (req, res) => res.sendFile(path.join(views, 'settings.html')));

module.exports = router;
