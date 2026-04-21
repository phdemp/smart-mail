const localProvider = require('./providers/local');
const { createRouter } = require('./router');

function log(rec) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...rec }) + '\n');
}

function getConfig() {
  return {
    order: ['local'],
    enabled: ['local'],
    keys: {},
    models: {}
  };
}

const router = createRouter({
  providers: [localProvider],
  getConfig,
  logger: log
});

module.exports = { router, _setConfigProvider: (fn) => { module.exports.router = createRouter({
  providers: [localProvider], getConfig: fn, logger: log
}); } };
