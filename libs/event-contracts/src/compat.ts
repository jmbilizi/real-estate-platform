import type { JsonSchema } from './registry';

type Node = Record<string, unknown>;

const isNode = (v: unknown): v is Node => typeof v === 'object' && v !== null && !Array.isArray(v);
const asSet = (v: unknown): Set<unknown> => new Set(Array.isArray(v) ? v : []);

/**
 * Lists the ways `next` rejects an event that the released `old` schema accepts.
 * An empty list means `next` is backward compatible. Adding an optional field is allowed.
 */
export function breakingChanges(old: JsonSchema, next: JsonSchema, at = '#'): string[] {
  const problems: string[] = [];
  const o = old as Node;
  const n = next as Node;

  if ('const' in o && JSON.stringify(o['const']) !== JSON.stringify(n['const'])) {
    problems.push(`${at}: const changed`);
  }
  if (o['type'] !== undefined && JSON.stringify(o['type']) !== JSON.stringify(n['type'])) {
    problems.push(
      `${at}: type changed from ${JSON.stringify(o['type'])} to ${JSON.stringify(n['type'])}`,
    );
  }
  if (o['format'] !== n['format'] && n['format'] !== undefined)
    problems.push(`${at}: format narrowed`);
  if (Array.isArray(o['enum'])) {
    const wider = asSet(n['enum']);
    if (!Array.isArray(n['enum']) || [...asSet(o['enum'])].some((v) => !wider.has(v))) {
      problems.push(`${at}: enum value removed`);
    }
  } else if (Array.isArray(n['enum'])) {
    problems.push(`${at}: enum added`);
  }
  for (const key of ['maxLength', 'maxProperties'] as const) {
    const before = o[key];
    const after = n[key];
    if (typeof before === 'number' && !(typeof after === 'number' && after >= before)) {
      problems.push(`${at}: ${key} narrowed`);
    }
    if (before === undefined && after !== undefined) problems.push(`${at}: ${key} added`);
  }
  for (const key of ['minLength', 'pattern'] as const) {
    if (o[key] !== n[key] && n[key] !== undefined) {
      if (
        key === 'minLength' &&
        typeof o[key] === 'number' &&
        typeof n[key] === 'number' &&
        n[key] <= o[key]
      )
        continue;
      problems.push(`${at}: ${key} narrowed`);
    }
  }
  if (JSON.stringify(o['not']) !== JSON.stringify(n['not']) && n['not'] !== undefined) {
    problems.push(`${at}: not constraint changed`);
  }
  if (
    JSON.stringify(o['propertyNames']) !== JSON.stringify(n['propertyNames']) &&
    n['propertyNames'] !== undefined
  ) {
    problems.push(`${at}: propertyNames changed`);
  }

  const oldRequired = asSet(o['required']);
  for (const key of asSet(n['required'])) {
    if (!oldRequired.has(key)) problems.push(`${at}: field ${String(key)} became required`);
  }

  if (o['additionalProperties'] !== false && n['additionalProperties'] === false) {
    problems.push(`${at}: additionalProperties narrowed`);
  }
  if (isNode(o['additionalProperties'])) {
    if (!isNode(n['additionalProperties'])) {
      if (n['additionalProperties'] === false)
        problems.push(`${at}: additionalProperties narrowed`);
    } else {
      problems.push(
        ...breakingChanges(
          o['additionalProperties'],
          n['additionalProperties'],
          `${at}/additionalProperties`,
        ),
      );
    }
  }

  const oldProps = isNode(o['properties']) ? o['properties'] : {};
  const newProps = isNode(n['properties']) ? n['properties'] : {};
  for (const [name, oldProp] of Object.entries(oldProps)) {
    const newProp = newProps[name];
    if (newProp === undefined) {
      problems.push(`${at}/properties/${name}: field removed`);
    } else if (isNode(oldProp) && isNode(newProp)) {
      problems.push(...breakingChanges(oldProp, newProp, `${at}/properties/${name}`));
    }
  }
  return problems;
}
