const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeColor } = require('./label');

test('normalizeColor accepts six hex digits and lowercases them', () => {
  assert.equal(normalizeColor('1D76DB'), '1d76db');
});

test('normalizeColor strips a leading # , which is how a colour is usually copied', () => {
  assert.equal(normalizeColor('#0E8A16'), '0e8a16');
});

test('normalizeColor rejects a short value instead of letting gh guess', () => {
  assert.throws(() => normalizeColor('1D7'), /--color must be 6 hex digits \(got "1D7"\)/);
});

test('normalizeColor rejects a colour name', () => {
  assert.throws(() => normalizeColor('blue'), /--color must be 6 hex digits/);
});
