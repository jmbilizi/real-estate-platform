import { fireEvent, render, screen } from '@testing-library/react';
import NavMenu, { getNavMenuItems } from './NavMenu';

function setup(signedIn: boolean) {
  const onAuth = jest.fn();
  const onLogout = jest.fn();
  render(<NavMenu signedIn={signedIn} onAuth={onAuth} onLogout={onLogout} />);
  const trigger = screen.getByRole('button', { name: 'More options' });
  return { trigger, onAuth, onLogout };
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

  it('lists Log in and Sign up first when signed out', () => {
    const { trigger } = setup(false);
    fireEvent.click(trigger);

    expect(labels().slice(0, 3)).toEqual(['Log in', 'Sign up', 'Help']);
    expect(labels()).not.toContain('Log out');
  });

  it('lists Account, Saved homes and Log out first when signed in', () => {
    const { trigger } = setup(true);
    fireEvent.click(trigger);

    expect(labels().slice(0, 4)).toEqual(['Account', 'Saved homes', 'Log out', 'Help']);
    expect(labels()).not.toContain('Log in');
  });

  it('opens the auth modal in the chosen mode and closes the menu', () => {
    const { trigger, onAuth } = setup(false);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign up' }));

    expect(onAuth).toHaveBeenCalledWith('signup');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('logs out', () => {
    const { trigger, onLogout } = setup(true);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Log out' }));

    expect(onLogout).toHaveBeenCalledTimes(1);
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

  it('gives every link a real destination', () => {
    const { secondary, primary } = getNavMenuItems(true);
    for (const item of [...primary, ...secondary]) {
      if (item.kind === 'link') expect(item.href).toMatch(/^(\/[a-z-]+|mailto:\S+@\S+)$/);
    }
  });
});
