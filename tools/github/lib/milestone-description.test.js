const test = require('node:test');
const assert = require('node:assert/strict');

const {
  INDENT,
  isEmpty,
  releaseMarkerProblem,
  formatDescription,
  appendDescription,
} = require('./milestone-description');

test('isEmpty covers null, undefined and whitespace', () => {
  assert.equal(isEmpty(null), true);
  assert.equal(isEmpty(undefined), true);
  assert.equal(isEmpty('   \n  '), true);
  assert.equal(isEmpty('Release: MVP'), false);
});

test('releaseMarkerProblem flags an empty description as a missing marker', () => {
  assert.match(releaseMarkerProblem(''), /release marker is missing/);
  assert.match(releaseMarkerProblem(null), /release marker is missing/);
});

test('releaseMarkerProblem accepts a well-formed marker', () => {
  assert.equal(releaseMarkerProblem('Release: MVP\n\nHomes search.'), null);
  assert.equal(releaseMarkerProblem('Release: post-MVP'), null);
});

test('releaseMarkerProblem skips leading blank lines before judging', () => {
  assert.equal(releaseMarkerProblem('\n\nRelease: MVP\n'), null);
});

test('releaseMarkerProblem names the line it found instead of the marker', () => {
  const problem = releaseMarkerProblem('Homes-first scope.\nRelease: MVP');
  assert.match(problem, /not a release marker/);
  assert.match(problem, /Homes-first scope\./);
});

test('releaseMarkerProblem rejects a marker with no value', () => {
  assert.match(releaseMarkerProblem('Release:'), /not a release marker/);
});

test('formatDescription indents every line', () => {
  assert.deepEqual(formatDescription('Release: MVP\nHomes.'), [
    `${INDENT}Release: MVP`,
    `${INDENT}Homes.`,
  ]);
});

test('formatDescription prints nothing for an empty description', () => {
  assert.deepEqual(formatDescription(''), []);
  assert.deepEqual(formatDescription(null), []);
});

test('formatDescription truncates with an explicit marker', () => {
  const description = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join('\n');
  const lines = formatDescription(description, { previewLines: 10 });
  assert.equal(lines.length, 11);
  assert.equal(lines[9], `${INDENT}line 10`);
  assert.match(lines[10], /… 15 more line\(s\) — run with --full/);
});

test('formatDescription --full prints every line', () => {
  const description = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join('\n');
  const lines = formatDescription(description, { full: true, previewLines: 10 });
  assert.equal(lines.length, 25);
  assert.equal(lines[24], `${INDENT}line 25`);
});

test('formatDescription reads a CRLF description the same as an LF one', () => {
  assert.deepEqual(formatDescription('Release: MVP\r\nHomes.'), formatDescription('Release: MVP\nHomes.'));
});

test('appendDescription separates the old text from the new with one blank line', () => {
  assert.equal(
    appendDescription('Release: MVP\n\nHomes search.\n', 'Ruling 2026-09-19: Connect is gated.'),
    'Release: MVP\n\nHomes search.\n\nRuling 2026-09-19: Connect is gated.',
  );
});

test('appendDescription onto an empty description keeps only the new text', () => {
  assert.equal(appendDescription('', 'Release: MVP'), 'Release: MVP');
  assert.equal(appendDescription(null, 'Release: MVP'), 'Release: MVP');
});
