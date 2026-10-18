import { render } from '@testing-library/react';
import { OVERLAY_OPEN_ATTRIBUTE, useOverlayOpen } from './overlay';

function Probe({ open }: { open: boolean }) {
  useOverlayOpen(open);
  return null;
}

const isOpen = () => document.documentElement.hasAttribute(OVERLAY_OPEN_ATTRIBUTE);

describe('useOverlayOpen', () => {
  it('sets the attribute while open and clears it on close', () => {
    const { rerender } = render(<Probe open />);
    expect(isOpen()).toBe(true);
    rerender(<Probe open={false} />);
    expect(isOpen()).toBe(false);
  });

  it('stays set until the last stacked overlay closes', () => {
    const a = render(<Probe open />);
    const b = render(<Probe open />);
    a.unmount();
    expect(isOpen()).toBe(true);
    b.unmount();
    expect(isOpen()).toBe(false);
  });
});
