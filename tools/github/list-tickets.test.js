const test = require('node:test');
const assert = require('node:assert/strict');

const { filterItems } = require('./list-tickets');

const ticket = (number, state, Status, extra = {}) => ({
  number,
  state,
  labels: [],
  milestone: null,
  fields: { Status, Priority: 'P0' },
  ...extra,
});

const READY_OPEN = ticket(10, 'OPEN', 'Ready');
const READY_DECLINED = ticket(11, 'CLOSED', 'Ready');

test('a declined ticket keeps its Status, so --status Ready must not return it', () => {
  const result = filterItems([READY_OPEN, READY_DECLINED], { status: 'Ready' });
  assert.deepEqual(
    result.map((item) => item.number),
    [10],
  );
});

test('--state closed returns only closed tickets', () => {
  const result = filterItems([READY_OPEN, READY_DECLINED], { state: 'closed' });
  assert.deepEqual(
    result.map((item) => item.number),
    [11],
  );
});

test('--state all returns both', () => {
  const result = filterItems([READY_OPEN, READY_DECLINED], { state: 'all' });
  assert.equal(result.length, 2);
});

test('--state matching is case-insensitive, like every other field comparison', () => {
  assert.equal(filterItems([READY_DECLINED], { state: 'CLOSED' }).length, 1);
});

test('an unknown --state is refused instead of filtering everything out', () => {
  assert.throws(
    () => filterItems([READY_OPEN], { state: 'archived' }),
    /--state must be open, closed or all \(got "archived"\)/,
  );
});

test('the other filters still apply on top of the state filter', () => {
  const items = [READY_OPEN, ticket(12, 'OPEN', 'Backlog')];
  assert.deepEqual(
    filterItems(items, { status: 'backlog' }).map((item) => item.number),
    [12],
  );
});
