#!/usr/bin/env node
'use strict';

// eval-corpus.js — Offline eval runner for IntelliMail classifier quality measurement.
//
// Usage:
//   node scripts/eval-corpus.js --export   Export 100 most recent emails from DB to corpus.json
//   node scripts/eval-corpus.js --score    Score corpus.json against the current classifier
//
// --export: reads intellimail.db read-only; writes .planning/eval/corpus.json
// --score:  sets DB_PATH to a throwaway temp path BEFORE any src/ require, to avoid
//           writing to the production DB. Calls buildPrompt + provider API per entry.

// IMPORTANT: In --score mode, set DB_PATH to a throwaway path BEFORE any src/ require.
// This is the first non-comment executable line for that mode — checked below.

const path = require('path');
const fs = require('fs');
const os = require('os');

const mode = process.argv[2];

if (!mode || (mode !== '--export' && mode !== '--score')) {
  console.error('Usage: node scripts/eval-corpus.js [--export|--score]');
  console.error('');
  console.error('  --export   Export 100 most recent emails from DB to .planning/eval/corpus.json');
  console.error('  --score    Score .planning/eval/corpus.json against the current classifier');
  process.exit(1);
}

const CORPUS_PATH = path.join(__dirname, '..', '.planning', 'eval', 'corpus.json');
const BASELINE_PATH = path.join(__dirname, '..', '.planning', 'eval', 'baseline.md');

// -------------------------------------------------------------------
// --export mode
// -------------------------------------------------------------------
if (mode === '--export') {
  const Database = require('better-sqlite3');
  const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'intellimail.db');

  let db;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (err) {
    console.error(`Could not open database at ${dbPath}: ${err.message}`);
    console.error('Hint: Run this from the project root, or set DB_PATH to the correct path.');
    process.exit(1);
  }

  let emails;
  try {
    emails = db.prepare(
      'SELECT id, subject, from_name, from_address, body_text FROM emails ORDER BY received_at DESC LIMIT 100'
    ).all();
  } catch (err) {
    console.error(`Failed to query emails table: ${err.message}`);
    db.close();
    process.exit(1);
  }
  db.close();

  const corpus = emails.map(r => ({
    id: r.id,
    subject: r.subject || '',
    from: (r.from_name ? r.from_name + ' <' + r.from_address + '>' : r.from_address) || '',
    body_snippet: (r.body_text || '').slice(0, 800),
    ground_truth_category: ''
  }));

  // Ensure .planning/eval/ directory exists
  const evalDir = path.dirname(CORPUS_PATH);
  if (!fs.existsSync(evalDir)) {
    fs.mkdirSync(evalDir, { recursive: true });
  }

  fs.writeFileSync(CORPUS_PATH, JSON.stringify(corpus, null, 2));
  console.log(`Exported ${corpus.length} emails to ${CORPUS_PATH} — add ground_truth_category to each entry`);
  process.exit(0);
}

// -------------------------------------------------------------------
// --score mode
// -------------------------------------------------------------------
if (mode === '--score') {
  // MUST set DB_PATH before any src/ require to avoid writing to production DB (T-01-02)
  process.env.DB_PATH = os.tmpdir() + '/eval-score-throwaway.db';

  const { buildPrompt, parseProviderResponse, CATEGORIES } = require('../src/llm/providers/base');

  // Read corpus
  let corpus;
  try {
    const raw = fs.readFileSync(CORPUS_PATH, 'utf8');
    corpus = JSON.parse(raw);
  } catch (err) {
    console.error(`Could not read corpus at ${CORPUS_PATH}: ${err.message}`);
    console.error('Hint: Run --export first to create the corpus file.');
    process.exit(1);
  }

  if (!Array.isArray(corpus)) {
    console.error('corpus.json must be a JSON array');
    process.exit(1);
  }

  // Filter to labeled entries only
  const labeled = corpus.filter(entry =>
    entry.ground_truth_category && CATEGORIES.includes(entry.ground_truth_category)
  );

  if (labeled.length === 0) {
    console.log('No labeled entries found in corpus.json.');
    console.log('Add ground_truth_category to each entry (must be one of: ' + CATEGORIES.join(', ') + ')');
    console.log('Skipped entries with empty or invalid ground_truth_category: ' + (corpus.length - labeled.length));
    process.exit(0);
  }

  // Determine provider to use
  // CR-03: Validate against an allowlist before require() to prevent path traversal.
  // Without this check, EVAL_PROVIDER=../../../etc/passwd would load an arbitrary path.
  const ALLOWED_PROVIDERS = new Set(['nvidia', 'groq', 'gemini', 'deepseek']);
  const providerName = process.env.EVAL_PROVIDER || 'nvidia';
  if (!ALLOWED_PROVIDERS.has(providerName)) {
    console.error(`Unknown provider '${providerName}'. Allowed: ${[...ALLOWED_PROVIDERS].join(', ')}`);
    process.exit(1);
  }
  console.log(`Scoring ${labeled.length} labeled emails using provider: ${providerName}`);
  console.log('(Unlabeled/invalid entries skipped: ' + (corpus.length - labeled.length) + ')');
  console.log('');

  // Dynamically load the provider (safe: providerName validated above)
  let provider;
  try {
    provider = require('../src/llm/providers/' + providerName);
  } catch (err) {
    console.error(`Could not load provider '${providerName}': ${err.message}`);
    console.error('Available providers: nvidia, groq, gemini, deepseek');
    process.exit(1);
  }

  // Determine API key
  const keyEnvMap = {
    nvidia: 'NVIDIA_API_KEY',
    groq: 'GROQ_API_KEY',
    gemini: 'GEMINI_API_KEY',
    deepseek: 'DEEPSEEK_API_KEY'
  };
  const keyEnv = keyEnvMap[providerName];
  const apiKey = keyEnv ? process.env[keyEnv] : null;

  if (!apiKey) {
    console.error(`No API key found. Set ${keyEnv || 'the provider API key env var'} to run --score.`);
    process.exit(1);
  }

  const providerCfg = {
    apiKey,
    model: provider.defaultModel || ''
  };

  // Score each entry
  const results = { total: 0, correct: 0, byCategory: {} };

  // Initialize per-category counters
  for (const cat of CATEGORIES) {
    results.byCategory[cat] = { correct: 0, total: 0 };
  }

  async function scoreAll() {
    for (const entry of labeled) {
      const emailObj = {
        from_name: '',
        from_address: entry.from || '',
        subject: entry.subject || '',
        body_text: entry.body_snippet || ''
      };

      let output;
      try {
        const rawResult = await provider.call(emailObj, { mode: 'full' }, providerCfg);
        if (typeof rawResult === 'string') {
          output = parseProviderResponse(rawResult);
        } else if (rawResult && typeof rawResult === 'object') {
          output = { ...rawResult };
        } else {
          output = { category: 'other', error: 'no_response' };
        }
      } catch (err) {
        console.warn(`  [WARN] Entry id=${entry.id} failed: ${err.message}`);
        output = { category: 'other', error: 'provider_error' };
      }

      const predicted = output.category || 'other';
      const truth = entry.ground_truth_category;
      const isCorrect = predicted === truth;

      results.total++;
      if (isCorrect) results.correct++;

      if (results.byCategory[truth]) {
        results.byCategory[truth].total++;
        if (isCorrect) results.byCategory[truth].correct++;
      }

      // Print progress dot
      process.stdout.write(isCorrect ? '.' : 'x');
    }
    console.log('');
    console.log('');
  }

  scoreAll().then(() => {
    const accuracy = results.total > 0 ? ((results.correct / results.total) * 100).toFixed(1) : '0.0';
    const now = new Date().toISOString().slice(0, 10);

    // Build report lines
    const reportLines = [];
    reportLines.push('=== IntelliMail Eval Corpus Accuracy ===');
    reportLines.push(`Total: ${results.total} emails | Correct: ${results.correct} | Accuracy: ${accuracy}%`);
    reportLines.push('');
    reportLines.push('By category:');

    const categoryLines = [];
    for (const cat of CATEGORIES) {
      const { correct, total } = results.byCategory[cat];
      if (total === 0) continue;
      const pct = ((correct / total) * 100).toFixed(1);
      const padded = cat.padEnd(16);
      categoryLines.push(`  ${padded}: ${correct}/${total}  (${pct}%)`);
    }
    for (const line of categoryLines) reportLines.push(line);

    // Print to stdout
    for (const line of reportLines) console.log(line);

    // Build markdown table for baseline.md
    const mdRows = [];
    for (const cat of CATEGORIES) {
      const { correct, total } = results.byCategory[cat];
      if (total === 0) continue;
      const pct = ((correct / total) * 100).toFixed(1);
      mdRows.push(`| ${cat} | ${correct}/${total} | ${pct}% |`);
    }

    const baseline = [
      '# Eval Baseline',
      '',
      `**Run:** ${now}`,
      `**Corpus:** ${results.total} labeled emails`,
      `**Overall accuracy:** ${accuracy}%`,
      `**Provider:** ${providerName}`,
      '',
      '## Per-category breakdown',
      '',
      '| Category | Correct/Total | Accuracy |',
      '|----------|--------------|----------|',
      ...mdRows,
      '',
      `*Generated by \`node scripts/eval-corpus.js --score\`*`
    ].join('\n');

    const evalDir = path.dirname(BASELINE_PATH);
    if (!fs.existsSync(evalDir)) {
      fs.mkdirSync(evalDir, { recursive: true });
    }
    fs.writeFileSync(BASELINE_PATH, baseline);
    console.log('');
    console.log(`Baseline written to ${BASELINE_PATH}`);
  }).catch(err => {
    console.error('Scoring failed:', err.message);
    process.exit(1);
  });
}
