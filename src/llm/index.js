const localProvider    = require('./providers/local');
const groqProvider     = require('./providers/groq');
const geminiProvider   = require('./providers/gemini');
const deepseekProvider = require('./providers/deepseek');
const { createRouter } = require('./router');
const { resolveConfig } = require('./config');

function log(rec) {
  process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\n');
}

const PROVIDERS = [localProvider, groqProvider, geminiProvider, deepseekProvider];

// Current router instance; swapped atomically by reload().
let current = createRouter({
  providers: PROVIDERS,
  getConfig: resolveConfig,
  logger: log
});

// Stable proxy so callers that destructure `router` keep working across reloads.
const router = {
  classify: (email, opts) => current.classify(email, opts)
};

function reload() {
  current = createRouter({
    providers: PROVIDERS,
    getConfig: resolveConfig,
    logger: log
  });
}

module.exports = { router, reload };
