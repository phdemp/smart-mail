const express = require('express');
const path = require('path');
const { getConfig } = require('../db');
const router = express.Router();

const views = path.join(__dirname, '..', '..', 'views');

router.get('/', (req, res) => {
  const cfg = getConfig();
  res.redirect(cfg ? '/dashboard' : '/setup');
});

router.get('/setup', (req, res) => {
  res.sendFile(path.join(views, 'setup.html'));
});

router.get('/dashboard', (req, res) => {
  res.sendFile(path.join(views, 'dashboard.html'));
});

router.get('/settings', (req, res) => {
  res.sendFile(path.join(views, 'settings.html'));
});

module.exports = router;
