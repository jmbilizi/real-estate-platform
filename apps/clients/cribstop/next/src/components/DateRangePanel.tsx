import React from 'react';

export type DateRange = {
  start: string;
  end: string;
  flexibility: 'exact' | '1' | '3' | '7' | '14' | '30' | '60' | '90' | '180' | '365' | '730';
};

export const PRICE_RANGES = [
  { label: 'Any price', min: '', max: '' },
  { label: 'Under $500k', min: '', max: '500000' },
  { label: '$500k – $1M', min: '500000', max: '1000000' },
  { label: '$1M – $2M', min: '1000000', max: '2000000' },
  { label: '$2M+', min: '2000000', max: '' },
];

export const BED_OPTIONS = [
  { label: 'Any beds', value: '' },
  { label: '1+ bed', value: '1' },
  { label: '2+ beds', value: '2' },
  { label: '3+ beds', value: '3' },
  { label: '4+ beds', value: '4' },
  { label: '5+ beds', value: '5' },
];

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function getDays(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDay(year: number, month: number) {
  return new Date(year, month, 1).getDay();
}

const FLEX_OPTIONS_RENT: { label: string; value: DateRange['flexibility'] }[] = [
  { label: 'Exact dates', value: 'exact' },
  { label: '± 1 day', value: '1' },
  { label: '± 3 days', value: '3' },
  { label: '± 1 week', value: '7' },
  { label: '± 2 weeks', value: '14' },
];
const FLEX_OPTIONS_BUY: { label: string; value: DateRange['flexibility'] }[] = [
  { label: 'Exact date', value: 'exact' },
  { label: '± 1 week', value: '7' },
  { label: '± 2 weeks', value: '14' },
  { label: '± 1 month', value: '30' },
  { label: '± 2 months', value: '60' },
  { label: '± 3 months', value: '90' },
  { label: '± 6 months', value: '180' },
  { label: '± 1 year', value: '365' },
  { label: '± 2 years', value: '730' },
];

export function DateRangePanel({
  dateRange,
  setDateRange,
  rangePickStep,
  setRangePickStep,
  hoveredDate,
  setHoveredDate,
  calendarBaseMonth,
  setCalendarBaseMonth,
  onClose,
  listingType,
  inline = false,
}: {
  dateRange: DateRange;
  setDateRange: (v: DateRange) => void;
  rangePickStep: 'start' | 'end';
  setRangePickStep: (v: 'start' | 'end') => void;
  hoveredDate: string | null;
  setHoveredDate: (v: string | null) => void;
  calendarBaseMonth: { year: number; month: number };
  setCalendarBaseMonth: (
    fn: (prev: { year: number; month: number }) => { year: number; month: number },
  ) => void;
  onClose: () => void;
  listingType?: 'for-sale' | 'for-rent';
  inline?: boolean;
}) {
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const flexOptions = listingType === 'for-sale' ? FLEX_OPTIONS_BUY : FLEX_OPTIONS_RENT;

  function prevMonth() {
    setCalendarBaseMonth(({ year: y, month: m }) => {
      const pm = m === 0 ? 11 : m - 1;
      const py = m === 0 ? y - 1 : y;
      const now = new Date();
      if (py < now.getFullYear() || (py === now.getFullYear() && pm < now.getMonth()))
        return { year: y, month: m };
      return { year: py, month: pm };
    });
  }
  function nextMonth() {
    setCalendarBaseMonth(({ year: y, month: m }) => {
      const nm = m === 11 ? 0 : m + 1;
      const ny = m === 11 ? y + 1 : y;
      return { year: ny, month: nm };
    });
  }

  function handleDayClick(ds: string) {
    if (ds < todayStr) return;
    if (rangePickStep === 'start' || !dateRange.start) {
      setDateRange({ ...dateRange, start: ds, end: '' });
      setRangePickStep('end');
    } else {
      if (ds < dateRange.start) {
        setDateRange({ ...dateRange, start: ds, end: dateRange.start });
      } else if (ds === dateRange.start) {
        setDateRange({ ...dateRange, end: ds });
      } else {
        setDateRange({ ...dateRange, end: ds });
      }
      setRangePickStep('start');
      onClose();
    }
  }

  function getEffectiveEnd() {
    return dateRange.end || (rangePickStep === 'end' && hoveredDate ? hoveredDate : '');
  }
  function isInRange(ds: string) {
    if (!dateRange.start) return false;
    const end = getEffectiveEnd();
    if (!end) return false;
    const lo = dateRange.start < end ? dateRange.start : end;
    const hi = dateRange.start < end ? end : dateRange.start;
    return ds > lo && ds < hi;
  }
  function isRangeStart(ds: string) {
    return ds === dateRange.start;
  }
  function isRangeEnd(ds: string) {
    const end = getEffectiveEnd();
    return !!end && ds === end && end !== dateRange.start;
  }

  function renderMonth(offset: number, showPrev: boolean, showNext: boolean, extraClass = '') {
    const totalMonth = calendarBaseMonth.month + offset;
    const year = calendarBaseMonth.year + Math.floor(totalMonth / 12);
    const month = ((totalMonth % 12) + 12) % 12;
    const daysInMonth = getDays(year, month);
    const firstDayOff = getFirstDay(year, month);
    return (
      <div key={`${offset}-${extraClass}`} className={`flex-1 min-w-0 ${extraClass}`}>
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={prevMonth}
            className={`p-1.5 rounded-full hover:bg-surface-alt transition-colors ${!showPrev ? 'invisible' : ''}`}
            aria-label="Previous month"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path
                d="M15 18l-6-6 6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <span className="text-sm font-semibold text-ink select-none">
            {MONTH_NAMES[month]} {year}
          </span>
          <button
            type="button"
            onClick={nextMonth}
            className={`p-1.5 rounded-full hover:bg-surface-alt transition-colors ${!showNext ? 'invisible' : ''}`}
            aria-label="Next month"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
              <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="grid grid-cols-7 mb-1">
          {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
            <div
              key={d}
              className="text-center text-[11px] text-ink-subtle font-medium py-1 select-none"
            >
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: firstDayOff }, (_, i) => (
            <div key={`e${i}`} />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => {
            const day = i + 1;
            const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const isPast = ds < todayStr;
            const isStart = isRangeStart(ds);
            const isEnd = isRangeEnd(ds);
            const inRange = isInRange(ds);
            const effectiveEnd = getEffectiveEnd();
            const hasEnd = !!(
              dateRange.end ||
              (rangePickStep === 'end' && hoveredDate && hoveredDate !== dateRange.start)
            );
            const isHovered =
              hoveredDate === ds && rangePickStep === 'end' && !isPast && ds !== dateRange.start;
            const isRangeLeft = isStart && hasEnd && dateRange.start < (effectiveEnd || '');
            const isRangeRight = isEnd && dateRange.start < (effectiveEnd || '');
            return (
              <div
                key={day}
                className={`relative flex items-center justify-center h-9
                  ${inRange ? 'bg-[#EBEBEB]' : ''}
                  ${isRangeLeft ? 'rounded-l-full' : ''}
                  ${isRangeRight ? 'rounded-r-full' : ''}
                `}
              >
                <button
                  type="button"
                  disabled={isPast}
                  onMouseEnter={() => !isPast && setHoveredDate(ds)}
                  onClick={() => handleDayClick(ds)}
                  className={`w-9 h-9 flex items-center justify-center rounded-full text-[13px] transition-colors focus:outline-none z-[1] relative
                    ${isStart || isEnd ? 'bg-ink text-white font-semibold' : ''}
                    ${isHovered && !isStart && !isEnd ? 'bg-ink/15 text-ink' : ''}
                    ${!isStart && !isEnd && !isHovered && !isPast ? 'hover:bg-surface-alt text-ink' : ''}
                    ${isPast ? 'text-ink-subtle/30 cursor-default' : 'cursor-pointer'}
                  `}
                >
                  {day}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const hasSelection = !!dateRange.start;
  const instructionText = !dateRange.start
    ? listingType === 'for-sale'
      ? 'Pick your target start date'
      : 'Pick your move-in date'
    : !dateRange.end && rangePickStep === 'end'
      ? 'Now pick an end date (or same day for exact)'
      : dateRange.end && dateRange.end !== dateRange.start
        ? `${dateRange.start} → ${dateRange.end}`
        : '';

  const calendarContent = (
    <div className={inline ? 'mt-2' : 'p-4 sm:p-6'} onMouseLeave={() => setHoveredDate(null)}>
      <div className="flex items-start justify-between mb-4 gap-4">
        <div className="min-w-0">
          <p className="font-semibold text-ink text-[15px] leading-snug">
            {listingType === 'for-sale'
              ? 'When are you looking to buy?'
              : 'When do you want to move in?'}
          </p>
          {instructionText && (
            <p className="text-[12px] text-ink-muted mt-0.5 truncate">{instructionText}</p>
          )}
        </div>
        {hasSelection && (
          <button
            type="button"
            onClick={() => {
              setDateRange({ start: '', end: '', flexibility: dateRange.flexibility });
              setRangePickStep('start');
            }}
            className="text-sm font-semibold text-brand hover:underline whitespace-nowrap flex-shrink-0"
          >
            Clear
          </button>
        )}
      </div>

      <div className="flex gap-6 lg:gap-10">
        {renderMonth(0, true, true, 'sm:hidden')}
        {renderMonth(0, true, false, 'hidden sm:block')}
        {renderMonth(1, false, true, 'hidden sm:block')}
      </div>

      <div className="mt-5 pt-4 border-t border-surface-border">
        <div className="flex flex-wrap gap-2">
          {flexOptions.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setDateRange({ ...dateRange, flexibility: opt.value })}
              className={`rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors whitespace-nowrap ${
                dateRange.flexibility === opt.value
                  ? 'border-ink bg-ink text-white'
                  : 'border-surface-border text-ink hover:border-ink'
              }`}
            >
              {opt.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setDateRange({ start: '', end: '', flexibility: 'exact' });
              setRangePickStep('start');
              onClose();
            }}
            className="rounded-full border border-surface-border px-3.5 py-1.5 text-[13px] font-medium text-ink-muted hover:border-ink hover:text-ink transition-colors whitespace-nowrap"
          >
            Any time
          </button>
        </div>
      </div>
    </div>
  );

  if (inline) return calendarContent;

  return (
    <div
      className="search-panel-enter absolute left-0 right-0 z-50 bg-white rounded-2xl shadow-[0_4px_24px_rgba(0,0,0,0.13)] border border-surface-border"
      style={{ top: 'calc(100% + 6px)' }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {calendarContent}
    </div>
  );
}
