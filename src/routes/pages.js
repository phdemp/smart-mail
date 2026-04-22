const express = require('express');
const path = require('path');
const router = express.Router();
const views = path.join(__dirname, '..', '..', 'views');

// Root: tiny HTML shell that redirects client-side.
// - If a token is in localStorage, go straight to the dashboard.
// - Otherwise, always land on /login. The login page has a "Sign up" link
//   that takes first-time visitors to /setup.
router.get('/', (req, res) => {
  res.type('html').send(`<!DOCTYPE html><script>
  (function(){
    const t = localStorage.getItem('intellimail_token');
    location.href = t ? '/dashboard' : '/login';
  })();
  </script>`);
});

router.get('/login',     (req, res) => res.sendFile(path.join(views, 'login.html')));
router.get('/setup',     (req, res) => res.sendFile(path.join(views, 'setup.html')));
router.get('/dashboard', (req, res) => res.sendFile(path.join(views, 'dashboard.html')));
router.get('/settings',  (req, res) => res.sendFile(path.join(views, 'settings.html')));

module.exports = router;
