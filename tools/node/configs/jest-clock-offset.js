/**
 * #940. Clock guard for Jest. `TEST_CLOCK_OFFSET_DAYS=365` moves the system clock ahead.
 * A spec that compares a fixed date with the real clock then fails.
 * A spec that pins its clock is unaffected, because fake timers replace `Date` later.
 * Load it with `setupFiles` in a project jest config.
 */
const days = Number(process.env.TEST_CLOCK_OFFSET_DAYS || 0);

if (days) {
  const offsetMs = days * 86_400_000;
  const RealDate = Date;
  class OffsetDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [RealDate.now() + offsetMs]));
    }
    static now() {
      return RealDate.now() + offsetMs;
    }
  }
  global.Date = OffsetDate;
}
