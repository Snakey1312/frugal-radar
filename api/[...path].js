// Vercel serverless entry point. Vercel passes Node-style (req, res), which is
// exactly what the local server handler expects — no adapter needed.
const { createAppServer } = require('../server');

const handler = createAppServer().handler;

module.exports = async function vercelHandler(req, res) {
  return handler(req, res);
};
