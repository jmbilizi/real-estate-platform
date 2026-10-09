import fs from 'fs';
import path from 'path';
import { fireEvent, render, screen } from '@testing-library/react';
import ToolbarIconButton, { FILTERS_ICON, GROUP_ICON } from './ToolbarIconButton';

describe('ToolbarIconButton (#748)', () => {
  it('renders the icon and no text', () => {
    render(<ToolbarIconButton label="Open filters" icon={FILTERS_ICON} />);
    const button = screen.getByRole('button', { name: 'Open filters' });
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg')).toBeTruthy();
  });

  it('shows the count badge above 0 and hides it at 0', () => {
    const { rerender } = render(
      <ToolbarIconButton label="Open filters" icon={FILTERS_ICON} count={0} countTestId="badge" />,
    );
    expect(screen.queryByTestId('badge')).toBeNull();
    rerender(
      <ToolbarIconButton label="Open filters" icon={FILTERS_ICON} count={3} countTestId="badge" />,
    );
    expect(screen.getByTestId('badge').textContent).toBe('3');
  });

  it('uses the label as the accessible name', () => {
    render(<ToolbarIconButton label="Open filters, 2 active" icon={FILTERS_ICON} count={2} />);
    expect(screen.getByRole('button', { name: 'Open filters, 2 active' })).toBeTruthy();
  });

  it('reports the pressed state', () => {
    const { rerender } = render(
      <ToolbarIconButton label="Group" icon={GROUP_ICON} pressed={false} />,
    );
    const button = screen.getByRole('button', { name: 'Group' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    rerender(<ToolbarIconButton label="Group" icon={GROUP_ICON} pressed />);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.className).toContain('bg-ink');
  });

  it('leaves aria-pressed off when it is not a toggle', () => {
    render(<ToolbarIconButton label="Group" icon={GROUP_ICON} active />);
    expect(screen.getByRole('button', { name: 'Group' }).hasAttribute('aria-pressed')).toBe(false);
  });

  it('is a 44 px round tap target and calls onClick', () => {
    const onClick = jest.fn();
    render(<ToolbarIconButton label="Group" icon={GROUP_ICON} onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Group' });
    expect(button.className).toContain('h-11');
    expect(button.className).toContain('w-11');
    expect(button.className).toContain('rounded-full');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is the one button behind the list toolbar and the map toolbar', () => {
    const read = (f: string) => fs.readFileSync(path.join(__dirname, f), 'utf8');
    expect(read('SearchExperience.tsx')).toContain('<ToolbarIconButton');
    expect(read('ToolbarSelect.tsx')).toContain('<ToolbarIconButton');
    expect(read('CustomMapControls.tsx')).toContain('<ToolbarIconButton');
    expect(fs.existsSync(path.join(__dirname, 'FilterButton.tsx'))).toBe(false);
  });
});
