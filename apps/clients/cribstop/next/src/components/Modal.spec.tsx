import type { ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import Modal from './Modal';

/**
 * jsdom does no layout, so its native `offsetParent` is `null` for every element except whichever
 * one currently has focus. The focus trap's visibility filter (`FOCUSABLE_SELECTOR` usage in
 * `Modal.tsx`) relies on `offsetParent` only going `null` for `display:none` chrome — true in a
 * real browser — so without this shim every button but the focused one is (wrongly) filtered out
 * of the trap's tab-stop list and the wrap-around never triggers. Non-source, jsdom-only fixup.
 */
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get(this: HTMLElement) {
      return this.style.display === 'none' ? null : this.parentNode;
    },
  });
});

/**
 * Renders the dialog alongside a control outside it, so the focus-trap tests can prove focus
 * never escapes there rather than merely asserting it lands somewhere inside the dialog.
 */
function renderWithOutsideButton(props: Partial<ComponentProps<typeof Modal>> = {}) {
  const onClose = jest.fn();
  render(
    <div>
      <button>Outside</button>
      <Modal open onClose={onClose} ariaLabel="Panel" {...props}>
        <button>First</button>
        <button>Last</button>
      </Modal>
    </div>,
  );
  return { onClose };
}

/** Toggles `open` via rerender, for the two tests that care about the open/close transition. */
function Harness({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div>
      <button>Outside</button>
      <Modal open={open} onClose={onClose} ariaLabel="Panel">
        <button>Inside</button>
      </Modal>
    </div>
  );
}

describe('Modal', () => {
  it('exposes dialog semantics', () => {
    renderWithOutsideButton();

    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('takes its accessible name from the title when one is given', () => {
    renderWithOutsideButton({ title: 'Save search' });

    expect(screen.getByRole('dialog', { name: 'Save search' })).toBeInTheDocument();
  });

  it('takes its accessible name from ariaLabel when there is no title', () => {
    renderWithOutsideButton({ ariaLabel: 'Listing filters' });

    expect(screen.getByRole('dialog', { name: 'Listing filters' })).toBeInTheDocument();
  });

  it('moves focus into the dialog when it opens', () => {
    const onClose = jest.fn();
    const { rerender } = render(<Harness open={false} onClose={onClose} />);

    const outsideButton = screen.getByRole('button', { name: 'Outside' });
    outsideButton.focus();
    expect(outsideButton).toHaveFocus();

    rerender(<Harness open onClose={onClose} />);

    expect(screen.getByRole('dialog')).toHaveFocus();
  });

  it('restores focus to the previously focused element when the dialog closes', () => {
    const onClose = jest.fn();
    const { rerender } = render(<Harness open={false} onClose={onClose} />);

    const outsideButton = screen.getByRole('button', { name: 'Outside' });
    outsideButton.focus();

    rerender(<Harness open onClose={onClose} />);
    expect(screen.getByRole('dialog')).toHaveFocus();

    rerender(<Harness open={false} onClose={onClose} />);

    expect(outsideButton).toHaveFocus();
  });

  it('wraps Tab from the last focusable element back to the first, never escaping to the page behind', () => {
    renderWithOutsideButton();

    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    const outside = screen.getByRole('button', { name: 'Outside' });

    last.focus();
    expect(last).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Tab' });

    expect(first).toHaveFocus();
    expect(outside).not.toHaveFocus();
  });

  it('wraps Shift+Tab from the first focusable element back to the last, never escaping to the page behind', () => {
    renderWithOutsideButton();

    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });
    const outside = screen.getByRole('button', { name: 'Outside' });

    first.focus();
    expect(first).toHaveFocus();

    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });

    expect(last).toHaveFocus();
    expect(outside).not.toHaveFocus();
  });
});
