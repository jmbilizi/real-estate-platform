import { fireEvent, render, screen } from '@testing-library/react';
import ListingsInfoPopover from './ListingsInfoPopover';

function setup() {
  render(
    <div>
      <button type="button">outside</button>
      <ListingsInfoPopover>
        <p>Summary text. Deemed reliable but not guaranteed.</p>
      </ListingsInfoPopover>
    </div>,
  );
  return screen.getByRole('button', { name: 'About these listings' });
}

describe('ListingsInfoPopover (#947)', () => {
  it('starts closed and keeps the text in the DOM, visually hidden', () => {
    const button = setup();
    expect(button).toHaveAttribute('aria-expanded', 'false');
    const text = screen.getByText(/Summary text/);
    expect(text.parentElement).toHaveClass('sr-only');
  });

  it('links the button to the panel it controls', () => {
    const button = setup();
    const panel = screen.getByRole('region', { name: 'About these listings' });
    expect(button).toHaveAttribute('aria-controls', panel.id);
  });

  it('opens on click and closes on a second click', () => {
    const button = setup();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Summary text/).parentElement).not.toHaveClass('sr-only');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes on Escape and returns focus to the button', () => {
    const button = setup();
    fireEvent.click(button);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveFocus();
  });

  it('closes when the pointer goes down outside', () => {
    const button = setup();
    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'outside' }));
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  it('stays open when the pointer goes down inside the panel', () => {
    const button = setup();
    fireEvent.click(button);
    fireEvent.pointerDown(screen.getByText(/Summary text/));
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });
});
