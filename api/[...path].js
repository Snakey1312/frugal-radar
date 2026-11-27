// Vercel serverless entry point. Vercel passes Node-style (req, res), which is
// exactly what the local server handler expects — no adapter needed.
let bootError = null;
let appHandler = null;

try {
  const { createAppServer } = require('../server');
  appHandler = createAppServer().handler;
} catch (err) {
  bootError = err;
}

function wantsDiagnostic(req) {
  return /(?:[?&])diag=1(?:&|$)/.test(String(req.url || ''));
}

function sendDiagnostic(res, label, err) {
  const body = `${label}\n${err && err.stack ? err.stack : String(err)}`;
  res.writeHead(500, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

module.exports = async function vercelHandler(req, res) {
  const diagnostic = wantsDiagnostic(req);
  if (bootError) {
    if (diagnostic) return sendDiagnostic(res, 'BOOT ERROR', bootError);
    return sendDiagnostic(res, 'A server error has occurred', new Error('FUNCTION_INVOCATION_FAILED'));
  }
  try {
    return await appHandler(req, res);
  } catch (err) {
    if (diagnostic) return sendDiagnostic(res, 'RUNTIME ERROR', err);
    throw err;
  }
};
