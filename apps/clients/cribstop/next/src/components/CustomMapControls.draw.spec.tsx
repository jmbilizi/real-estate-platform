/** #747. The Draw, Redraw, Cancel and Clear buttons on the map controls. */
const container = document.createElement('div');
jest.mock('react-leaflet', () => ({
  useMap: () => ({
    getContainer: () => container,
    invalidateSize: jest.fn(),
    zoomIn: jest.fn(),
    zoomOut: jest.fn(),
  }),
}));

import { fireEvent, render, screen } from '@testing-library/react';
import { CustomMapControls, type DrawControls } from './CustomMapControls';

const controls = (patch: Partial<DrawControls> = {}): DrawControls => ({
  drawing: false,
  hasArea: false,
  onToggle: jest.fn(),
  onClear: jest.fn(),
  ...patch,
});

describe('draw controls', () => {
  it('shows no draw button when the page gives none', () => {
    render(<CustomMapControls />);
    expect(screen.queryByTestId('map-draw')).toBeNull();
  });

  it('starts draw mode with a tap, with no prior zoom needed', () => {
    const draw = controls();
    render(<CustomMapControls draw={draw} />);

    const button = screen.getByRole('button', { name: 'Draw an area' });
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.className).toContain('h-11 w-11');
    fireEvent.click(button);
    expect(draw.onToggle).toHaveBeenCalledTimes(1);
  });

  it('turns into a Cancel button while drawing, and a second tap ends draw mode', () => {
    const draw = controls({ drawing: true });
    render(<CustomMapControls draw={draw} />);

    const button = screen.getByRole('button', { name: 'Cancel drawing' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button);
    expect(draw.onToggle).toHaveBeenCalledTimes(1);
  });

  it('offers Redraw and Clear when a shape exists, and Clear removes it', () => {
    const draw = controls({ hasArea: true });
    render(<CustomMapControls draw={draw} />);

    expect(screen.getByRole('button', { name: 'Redraw area' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear drawn area' }));
    expect(draw.onClear).toHaveBeenCalledTimes(1);
  });

  it('hides Clear while a new shape is being drawn', () => {
    render(<CustomMapControls draw={controls({ hasArea: true, drawing: true })} />);
    expect(screen.queryByTestId('map-draw-clear')).toBeNull();
  });
});
