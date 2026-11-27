'use strict';

const os = require('node:os');
const path = require('node:path');

// Offline, keyless product hint from visible text in a photo. The pure parsing
// logic is shared with the browser OCR fallback in public/ocr-parse.js.
const { createWorker } = require('tesseract.js');
const { buildResult, normalize } = require('../public/ocr-parse.js');

let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('eng', 1, {
      cachePath: process.env.TESSDATA_CACHE || path.join(os.tmpdir(), 'frugalradar-tessdata'),
      logger: () => {},
    }).catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

async function identifyImageLocally(base64, _mimeType) {
  let worker;
  try {
    worker = await getWorker();
    const image = Buffer.isBuffer(base64) ? base64 : Buffer.from(String(base64 || ''), 'base64');
    const { data } = await worker.recognize(image);
    const lines = String(data?.text || '')
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    return buildResult(lines);
  } catch {
    return null;
  } finally {
    // Keep the worker warm for subsequent requests, but never leak more than one.
    if (worker && process.env.VERCEL) {
      await worker.terminate().catch(() => {});
      workerPromise = null;
    }
  }
}

module.exports = { identifyImageLocally, buildResult, normalize };
