/**
 * One argv parser for the tools/github/*.js scripts.
 *
 * Every script here takes the same shape of arguments: `--key value`, boolean flags, a few
 * repeatable flags, and (for milestone.js) a leading subcommand. Each script used to carry its own
 * copy, and the copies disagreed on the one case that matters — a value flag whose value is missing
 * or is the next flag. `--title --close` then silently retitles the ticket to "--close".
 *
 * Rules:
 *   - a key in `flags` takes no value and becomes `true`
 *   - a key in `repeatable` accumulates into an array
 *   - every other key takes the next argv element, which must exist and must not look like a flag
 *   - bare words go to `args._` when `positionals` is on, and are ignored otherwise
 *
 * Throws on a malformed argument. Callers catch and route the message through `die`.
 */

/** `repeatable` accepts an array, or an object mapping a key to the noun used in its error text. */
function normalizeRepeatable(repeatable) {
  if (Array.isArray(repeatable)) {
    return Object.fromEntries(repeatable.map((key) => [key, 'a value']));
  }
  return repeatable;
}

function parseArgs(argv, options = {}) {
  const flags = new Set(options.flags || []);
  const repeatable = normalizeRepeatable(options.repeatable || {});
  const args = options.positionals ? { _: [] } : {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue; // pnpm forwards the literal '--' separator — never a flag
    if (!arg.startsWith('--')) {
      if (options.positionals) args._.push(arg);
      continue;
    }

    const key = arg.slice(2);
    if (flags.has(key)) {
      args[key] = true;
      continue;
    }

    const noun = repeatable[key] || 'a value';
    const value = argv[i + 1];
    if (value === undefined || value === '') throw new Error(`--${key} requires ${noun}`);
    if (value.startsWith('--')) throw new Error(`--${key} requires ${noun} (got "${value}")`);

    if (key in repeatable) {
      (args[key] ||= []).push(value);
    } else {
      args[key] = value;
    }
    i++;
  }

  return args;
}

module.exports = { parseArgs };
