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
    expect(button.className).toContain('text-ink');
  });

  it('shows the active state with a darker, filled icon and no filled background', () => {
    const { rerender } = render(<ToolbarIconButton label="Group" icon={GROUP_ICON} />);
    const idle = screen.getByRole('button', { name: 'Group' });
    expect(idle.className).toContain('text-ink-muted');
    expect(idle.querySelector('svg')?.getAttribute('fill')).toBe('none');
    rerender(<ToolbarIconButton label="Group" icon={GROUP_ICON} pressed />);
    const on = screen.getByRole('button', { name: 'Group' });
    expect(on.className).not.toContain('text-ink-muted');
    expect(on.className).toContain('bg-transparent');
    expect(on.className).toContain('border-gray-300');
    expect(on.className).not.toContain('bg-ink');
    expect(on.querySelector('svg')?.getAttribute('fill')).toBe('currentColor');
    expect(on.getAttribute('aria-pressed')).toBe('true');
    rerender(<ToolbarIconButton label="Group" icon={GROUP_ICON} active />);
    expect(
      screen.getByRole('button', { name: 'Group' }).querySelector('svg')?.getAttribute('fill'),
    ).toBe('currentColor');
  });

  it('leaves aria-pressed off when it is not a toggle', () => {
    render(<ToolbarIconButton label="Group" icon={GROUP_ICON} active />);
    expect(screen.getByRole('button', { name: 'Group' }).hasAttribute('aria-pressed')).toBe(false);
  });

  it('sets the tooltip from the label, or from tooltip when given', () => {
    const { rerender } = render(<ToolbarIconButton label="Draw an area" icon={GROUP_ICON} />);
    expect(screen.getByRole('button', { name: 'Draw an area' }).getAttribute('title')).toBe(
      'Draw an area',
    );
    rerender(<ToolbarIconButton label="Sort, current: Newest" tooltip="Sort" icon={GROUP_ICON} />);
    const button = screen.getByRole('button', { name: 'Sort, current: Newest' });
    expect(button.getAttribute('title')).toBe('Sort');
  });

  it('has a transparent fill and a light border, with no white fill', () => {
    render(<ToolbarIconButton label="Group" icon={GROUP_ICON} />);
    const cls = screen.getByRole('button', { name: 'Group' }).className;
    expect(cls).toContain('bg-transparent');
    expect(cls).toContain('border-gray-300');
    expect(cls).toContain('hover:bg-surface-soft');
    expect(cls).not.toContain('bg-white');
  });

  it('keeps a caller-set absolute position instead of forcing relative', () => {
    const { rerender } = render(<ToolbarIconButton label="Close" icon={GROUP_ICON} />);
    expect(screen.getByRole('button', { name: 'Close' }).className).toContain('relative');
    rerender(
      <ToolbarIconButton label="Close" icon={GROUP_ICON} className="absolute right-4 top-4" />,
    );
    const cls = screen.getByRole('button', { name: 'Close' }).className;
    expect(cls).toContain('absolute');
    expect(cls).not.toMatch(/(^|s)relative(s|$)/);
  });

  it('does not light up on hover while disabled', () => {
    render(<ToolbarIconButton label="Next" icon={GROUP_ICON} disabled />);
    expect(screen.getByRole('button', { name: 'Next' }).className).toContain(
      'disabled:hover:bg-transparent',
    );
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

  it('is transparent on the page surface by default', () => {
    render(<ToolbarIconButton label="Group" icon={GROUP_ICON} />);
    const { className } = screen.getByRole('button', { name: 'Group' });
    expect(className).toContain('bg-transparent');
    expect(className).not.toContain('bg-white');
  });

  it('is white with a distinct hover on the map surface and keeps the shared look (#764)', () => {
    render(
      <ToolbarIconButton
        label="Zoom in"
        icon={GROUP_ICON}
        surface="map"
        count={2}
        countTestId="b"
      />,
    );
    const button = screen.getByRole('button', { name: 'Zoom in' });
    for (const c of [
      'bg-white',
      'hover:bg-gray-100',
      'h-11',
      'w-11',
      'rounded-full',
      'border-gray-300',
    ]) {
      expect(button.className).toContain(c);
    }
    expect(button.className).not.toContain('bg-transparent');
    expect(button.getAttribute('title')).toBe('Zoom in');
    expect(screen.getByTestId('b').textContent).toBe('2');
  });

  it('keeps the active look on the map surface: filled icon, no dark background', () => {
    render(<ToolbarIconButton label="Draw" icon={GROUP_ICON} surface="map" pressed />);
    const button = screen.getByRole('button', { name: 'Draw' });
    expect(button.className).toContain('text-ink');
    expect(button.className).not.toContain('bg-ink');
    expect(button.querySelector('svg')?.getAttribute('fill')).toBe('currentColor');
  });

  it('is the one button behind the list toolbar and the map toolbar', () => {
    const read = (f: string) => fs.readFileSync(path.join(__dirname, f), 'utf8');
    expect(read('SearchExperience.tsx')).toContain('<ToolbarIconButton');
    expect(read('ToolbarSelect.tsx')).toContain('<ToolbarIconButton');
    expect(read('CustomMapControls.tsx')).toContain('<ToolbarIconButton');
    for (const f of ['DismissButton', 'CarouselShell', 'PropertyGallery', 'ListingDetailContent']) {
      expect(read(f + '.tsx')).toContain('<ToolbarIconButton');
    }
    expect(fs.existsSync(path.join(__dirname, 'FilterButton.tsx'))).toBe(false);
  });
});
