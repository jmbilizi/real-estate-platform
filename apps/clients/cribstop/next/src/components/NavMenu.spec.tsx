import { fireEvent, render, screen } from '@testing-library/react';
import NavMenu, { getNavMenuItems } from './NavMenu';

function setup(signedIn: boolean) {
  const onAuth = jest.fn();
  render(<NavMenu signedIn={signedIn} onAuth={onAuth} />);
  const trigger = screen.getByRole('button', { name: 'More options' });
  return { trigger, onAuth };
}

const labels = () => screen.getAllByRole('menuitem').map((el) => el.textContent);

describe('NavMenu', () => {
  it('has a label, a tooltip and menu attributes on the trigger', () => {
    const { trigger } = setup(false);

    expect(trigger).toHaveAttribute('title', 'More options');
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('lists one Sign in or sign up item first when signed out', () => {
    const { trigger } = setup(false);
    fireEvent.click(trigger);

    expect(labels().slice(0, 3)).toEqual(['Sign in or sign up', 'Help', 'About']);
    expect(labels()).not.toContain('Log out');
  });

  it('lists only the secondary items when signed in, with no separator', () => {
    const { trigger } = setup(true);
    fireEvent.click(trigger);

    expect(labels().slice(0, 2)).toEqual(['Help', 'About']);
    for (const l of ['Account', 'Saved homes', 'Log out', 'Sign in or sign up']) {
      expect(labels()).not.toContain(l);
    }
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
  });

  it('opens the auth modal and closes the menu', () => {
    const { trigger, onAuth } = setup(false);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign in or sign up' }));

    expect(onAuth).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on Escape and returns focus to the trigger', () => {
    const { trigger } = setup(false);
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes on an outside click', () => {
    const { trigger } = setup(false);
    fireEvent.click(trigger);

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('moves focus with the arrow keys', () => {
    const { trigger } = setup(false);
    fireEvent.click(trigger);
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();

    fireEvent.keyDown(screen.getByRole('menu'), { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'End' });
    expect(items[items.length - 1]).toHaveFocus();
  });

  it('uses the same SlidePanel width as the Apps dropdown', () => {
    const { trigger } = setup(false);
    fireEvent.click(trigger);

    expect(screen.getByRole('dialog')).toHaveStyle({ width: '314px' });
  });

  it('closes when the trigger is pressed again, without reopening', () => {
    const { trigger } = setup(false);
    fireEvent.click(trigger);
    expect(screen.getByRole('menu')).toBeInTheDocument();

    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('gives every link a real destination', () => {
    const { secondary, primary } = getNavMenuItems(true);
    for (const item of [...primary, ...secondary]) {
      if (item.kind === 'link') expect(item.href).toMatch(/^(\/[a-z-]+|mailto:\S+@\S+)$/);
    }
  });
});
