import { fireEvent, render, screen } from '@testing-library/react';
import { Copy } from 'lucide-react';
import ListingCardMenu from './ListingCardMenu';

describe('ListingCardMenu (#452)', () => {
  function renderMenu(onSelect = jest.fn()) {
    return {
      onSelect,
      ...render(<ListingCardMenu items={[{ label: 'Copy link', icon: Copy, onSelect }]} />),
    };
  }

  it('renders nothing but the trigger until opened', () => {
    renderMenu();

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(screen.getByLabelText('More options')).toBeInTheDocument();
  });

  it('sizes the trigger to the dots column, so the row gap spaces it like save and share (#467)', () => {
    renderMenu();
    const trigger = screen.getByLabelText('More options');
    const glyph = trigger.querySelector('svg');

    expect(trigger).toHaveClass('w-1');
    expect(glyph).toHaveAttribute('width', '4');
    expect(glyph).toHaveAttribute('viewBox', '8 0 6 24');
  });

  it('opens the menu on trigger click, with correct ARIA', () => {
    renderMenu();
    const trigger = screen.getByLabelText('More options');

    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const menu = screen.getByRole('menu');
    expect(menu).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Copy link' })).toBeInTheDocument();
  });

  it('gives every item a leading, aria-hidden icon', () => {
    renderMenu();
    fireEvent.click(screen.getByLabelText('More options'));

    const item = screen.getByRole('menuitem', { name: 'Copy link' });
    const icon = item.querySelector('svg');
    expect(icon).toBeInTheDocument();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    // The accessible name comes from the text alone, not the icon.
    expect(item).toHaveAccessibleName('Copy link');
  });

  it('renders the menu as a direct child of document.body — a portal, not a positioned sibling', () => {
    const { container } = renderMenu();
    fireEvent.click(screen.getByLabelText('More options'));

    const menu = screen.getByRole('menu');
    // Not inside the component's own render tree.
    expect(container.contains(menu)).toBe(false);
    expect(menu.parentElement).toBe(document.body);
  });

  it('closes on outside click', () => {
    renderMenu();
    fireEvent.click(screen.getByLabelText('More options'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    renderMenu();
    const trigger = screen.getByLabelText('More options');
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes on Tab, since focus is about to leave it with no trap to catch it', () => {
    renderMenu();
    fireEvent.click(screen.getByLabelText('More options'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Tab' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('wraps ArrowUp to the last item even when nothing in the menu has focus yet', () => {
    // Two items: with only one, `(current - 1 + len) % len` happens to still resolve to index
    // 0 for `current === -1` and the regression this pins would go uncaught.
    render(
      <ListingCardMenu
        items={[
          { label: 'Copy link', icon: Copy, onSelect: jest.fn() },
          { label: 'Second', icon: Copy, onSelect: jest.fn() },
        ]}
      />,
    );
    fireEvent.click(screen.getByLabelText('More options'));
    const last = screen.getByRole('menuitem', { name: 'Second' });
    (document.activeElement as HTMLElement)?.blur();
    expect(document.activeElement).not.toBe(last);

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowUp' });

    expect(last).toHaveFocus();
  });

  it('closes on scroll', () => {
    renderMenu();
    fireEvent.click(screen.getByLabelText('More options'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.scroll(window);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on resize', () => {
    renderMenu();
    fireEvent.click(screen.getByLabelText('More options'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.resize(window);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('runs the item action and closes the menu on selection', () => {
    const onSelect = jest.fn();
    renderMenu(onSelect);
    fireEvent.click(screen.getByLabelText('More options'));

    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy link' }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('does not let a click inside the menu bubble to a card-level click handler', () => {
    const cardClick = jest.fn();
    render(
      <div onClick={cardClick}>
        <ListingCardMenu items={[{ label: 'Copy link', icon: Copy, onSelect: jest.fn() }]} />
      </div>,
    );
    fireEvent.click(screen.getByLabelText('More options'));
    cardClick.mockReset(); // the trigger's own click already stops propagation; isolate the menu

    fireEvent.click(screen.getByRole('menu'));

    expect(cardClick).not.toHaveBeenCalled();
  });
});
