import { fireEvent, render, screen } from '@testing-library/react';
import FilterModal from './FilterModal';

jest.mock('@/components/FilterModalContent', () => ({
  __esModule: true,
  default: () => <input aria-label="Min price" />,
}));

describe('FilterModal focus (#576)', () => {
  const setup = () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const view = render(
      <FilterModal onClose={jest.fn()} filters={{}} onChange={jest.fn()} resultCount={0} />,
    );
    return { opener, view };
  };

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('moves focus into the dialog on open', () => {
    setup();

    expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Filters' }));
  });

  it('wraps Tab from the last control to the first, and Shift+Tab back', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    const items = Array.from(dialog.querySelectorAll<HTMLElement>('button, input'));
    const first = items[0];
    const last = items[items.length - 1];

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('returns focus to the opener on close', () => {
    const { opener, view } = setup();
    view.unmount();

    expect(document.activeElement).toBe(opener);
  });
});
