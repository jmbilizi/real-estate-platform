import {
  checkPassword,
  DEFAULT_PASSWORD_POLICY,
  passphraseHint,
  passwordMeetsRules,
} from './password-rules';

const metIds = (password: string) =>
  checkPassword(password)
    .rules.filter((rule) => rule.met)
    .map((rule) => rule.id);

describe('password rules (either 8+ with every class, or 15+)', () => {
  it.each([
    ['Abcde1!x', true],
    ['Abc1!ef', false],
    ['abcdefghijklmn', false],
    ['abcdefghijklmno', true],
    ['Abcdefg1', false],
    ['abcdef1!', false],
    ['ABCDEF1!', false],
    ['Abcdefg!', false],
    ['Abcdef1!', true],
    ['', false],
  ])('%s -> %s', (password, valid) => {
    expect(passwordMeetsRules(password)).toBe(valid);
  });

  it('ticks each rule as it is met', () => {
    expect(metIds('')).toEqual([]);
    expect(metIds('abc')).toEqual(['lower']);
    expect(metIds('abcdefgh')).toEqual(['length', 'lower']);
    expect(metIds('Abcdefg1!')).toEqual(['length', 'upper', 'lower', 'digit', 'symbol']);
  });

  it('shows every rule as met at 15 characters', () => {
    const check = checkPassword('a'.repeat(15));
    expect(check.passphrase).toBe(true);
    expect(check.rules.every((rule) => rule.met)).toBe(true);
    expect(checkPassword('a'.repeat(14)).passphrase).toBe(false);
  });

  it('reads the thresholds from the policy', () => {
    const policy = { ...DEFAULT_PASSWORD_POLICY, minLength: 10, passphraseLength: 20 };
    expect(passwordMeetsRules('Abcde1!xy', policy)).toBe(false);
    expect(passwordMeetsRules('Abcde1!xyz', policy)).toBe(true);
    expect(passphraseHint(policy)).toBe('Or use 20+ characters, no other rules.');
  });
});
