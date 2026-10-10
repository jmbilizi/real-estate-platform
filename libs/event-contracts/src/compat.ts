import type { JsonSchema } from './registry';

type Node = Record<string, unknown>;

const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null && !Array.isArray(v);
const asList = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined ? [] : [v]);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Keywords that carry no validation meaning. A change to them is never breaking. */
const ANNOTATIONS = new Set(['$schema', '$id', 'title', 'description']);
/** Keywords this checker understands. Any other keyword that changes fails closed. */
const HANDLED = new Set([
  'type',
  'const',
  'enum',
  'format',
  'pattern',
  'minLength',
  'maxLength',
  'maxProperties',
  'not',
  'propertyNames',
  'required',
  'properties',
  'additionalProperties',
]);

function checkNumberLimit(o: Node, n: Node, key: string, at: string, out: string[]): void {
  const before = o[key];
  const after = n[key];
  if (key === 'minLength') {
    if (typeof after === 'number' && !(typeof before === 'number' && after <= before)) {
      out.push(`${at}: ${key} narrowed`);
    }
    return;
  }
  // maxLength, maxProperties: a larger limit or no limit is wider.
  if (typeof after === 'number' && !(typeof before === 'number' && after >= before)) {
    out.push(`${at}: ${key} narrowed`);
  }
}

/** A schema that adds any validation keyword narrows what it accepts. */
const constrains = (schema: unknown): boolean =>
  isNode(schema) && Object.keys(schema).some((k) => !ANNOTATIONS.has(k));

/**
 * Lists the ways `next` rejects an event that the released `old` schema accepts.
 * An empty list means `next` is backward compatible. Removing a limit is allowed.
 * Adding a constrained property is not, because old events may already carry that key.
 */
export function breakingChanges(old: JsonSchema, next: JsonSchema, at = '#'): string[] {
  const out: string[] = [];
  const o = old as Node;
  const n = next as Node;

  for (const key of new Set([...Object.keys(o), ...Object.keys(n)])) {
    if (!HANDLED.has(key) && !ANNOTATIONS.has(key) && !same(o[key], n[key])) {
      out.push(`${at}: unsupported keyword ${key} changed`);
    }
  }

  if (n['const'] !== undefined && !same(o['const'], n['const'])) out.push(`${at}: const changed`);

  if (n['type'] !== undefined) {
    const allowed = asList(n['type']);
    const old_ = asList(o['type']);
    if (old_.length === 0 || old_.some((t) => !allowed.includes(t))) {
      out.push(
        `${at}: type changed from ${JSON.stringify(o['type'])} to ${JSON.stringify(n['type'])}`,
      );
    }
  }
  if (n['format'] !== undefined && n['format'] !== o['format']) out.push(`${at}: format narrowed`);

  if (Array.isArray(n['enum'])) {
    const wider = n['enum'];
    if (!Array.isArray(o['enum']) || o['enum'].some((v) => !wider.some((w) => same(v, w)))) {
      out.push(`${at}: enum value removed or enum added`);
    }
  }

  for (const key of ['maxLength', 'maxProperties', 'minLength'])
    checkNumberLimit(o, n, key, at, out);
  if (n['pattern'] !== undefined && n['pattern'] !== o['pattern'])
    out.push(`${at}: pattern narrowed`);
  if (n['not'] !== undefined && !same(o['not'], n['not']))
    out.push(`${at}: not constraint changed`);
  if (n['propertyNames'] !== undefined && !same(o['propertyNames'], n['propertyNames'])) {
    out.push(`${at}: propertyNames changed`);
  }

  const oldRequired = asList(o['required']);
  for (const key of asList(n['required'])) {
    if (!oldRequired.includes(key)) out.push(`${at}: field ${String(key)} became required`);
  }

  const oldAdditional = o['additionalProperties'];
  const newAdditional = n['additionalProperties'];
  if (oldAdditional === false) {
    // Old schema rejected unknown keys, so new keys only widen it.
  } else if (newAdditional === false) {
    out.push(`${at}: additionalProperties narrowed`);
  } else if (constrains(newAdditional)) {
    out.push(
      ...(isNode(oldAdditional)
        ? breakingChanges(oldAdditional, newAdditional as Node, `${at}/additionalProperties`)
        : [`${at}: additionalProperties narrowed`]),
    );
  }

  const oldProps = isNode(o['properties']) ? o['properties'] : {};
  const newProps = isNode(n['properties']) ? n['properties'] : {};
  for (const [name, oldProp] of Object.entries(oldProps)) {
    const newProp = newProps[name];
    if (newProp === undefined) {
      if (oldAdditional === false || constrains(oldProp)) {
        out.push(`${at}/properties/${name}: field removed`);
      }
    } else if (isNode(oldProp) && isNode(newProp)) {
      out.push(...breakingChanges(oldProp, newProp, `${at}/properties/${name}`));
    }
  }
  for (const [name, newProp] of Object.entries(newProps)) {
    if (name in oldProps || oldAdditional === false) continue;
    const base = isNode(oldAdditional) ? oldAdditional : {};
    // A new property must not be stricter than what the old schema already allowed for that key.
    if (isNode(newProp)) out.push(...breakingChanges(base, newProp, `${at}/properties/${name}`));
  }
  return out;
}
