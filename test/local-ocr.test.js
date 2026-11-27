'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildResult, normalize } = require('../lib/local-ocr');

test('keyless OCR reads the searched query, size, category and color from a screenshot', () => {
  // Lines as returned by Tesseract.js for the original "Stoc neverificat" screenshot.
  const lines = [
    'FrugalRadar — Comparator intelige X ~~ @) veinz pre workout - Cautare GX + ea o X',
    'Oferte sale gasite pentru ,, nike air max tn triple black’ @ Doar cu marimea in stoc',
    'Categorie: Incaltaminte - 6 oferte verificate live + Marimea 41: 5 disponibile',
    'Pantofi sport Nike W Air Max Plus TN, Negru 399,00 lei',
    'Nike, Pantofi sport de piele si piele ecologica Air Max, Negru 475,35 lei',
  ];

  const result = buildResult(lines);
  assert.equal(result.query, 'nike air max tn triple black');
  assert.equal(result.category, 'shoes');
  assert.equal(result.size, '41');
  assert.equal(result.brand, 'Nike');
  assert.equal(result.color, 'black');
  assert.equal(result.confidence, 0.92);
});

test('keyless OCR falls back to brand + model when no explicit query is visible', () => {
  const result = buildResult([
    'Pantofi sport Nike Air Force 1 Low Triple Black CW2288-001',
    'Marime 42.5 EU',
  ]);
  assert.equal(result.query, 'Nike Air Force 1 triple black');
  assert.equal(result.category, 'shoes');
  assert.equal(result.size, '42.5');
});

test('keyless OCR reads brand, model and color from a retail breadcrumb screenshot', () => {
  // Real Tesseract output from an UGG product screenshot (kids listing, camel).
  const lines = [
    '¢ INAPOI | Sneakers Copii > Pantofi sport stil gheata Copii > Pantofi sport stil gheata UGG > UGG LOWMEL',
    'N LOWME',
    '’ RICX Camel',
    'NY @ 695,00lei 625,5',
    'P gli — 31- In stoc',
  ];

  const result = buildResult(lines);
  assert.equal(result.query, 'UGG Lowmel camel');
  assert.equal(result.category, 'shoes');
  assert.equal(result.brand, 'UGG');
  assert.equal(result.model, 'Lowmel');
  assert.equal(result.color, 'camel');
  assert.equal(result.colorTerm, 'camel');
  assert.equal(result.audience, 'kids');
  assert.equal(result.size, '');
  assert.equal(result.confidence, 0.92);
});

test('keyless OCR returns null for empty images and normalizes Romanian diacritics', () => {
  assert.equal(buildResult([]), null);
  assert.equal(normalize('Mărime 41, Încălțăminte'), 'marime 41 incaltaminte');
});
