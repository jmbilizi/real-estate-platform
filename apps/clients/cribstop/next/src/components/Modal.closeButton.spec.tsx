import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import Modal from './Modal';
import StandaloneAuth from './StandaloneAuth';
import { Z_LAYERS } from '@/lib/z-layers';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ back: jest.fn(), replace: jest.fn(), push: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
jest.mock('./AuthForm', () => ({ __esModule: true, default: () => <div>form</div> }));

/**
 * The close button contract (#945). A phone dialog must always show its close button, in the
 * dialog's own header row, above all app chrome.
 */
describe('Modal close button contract', () => {
  it('puts the close button in the sticky header slot, the first child of the card', () => {
    render(
      <Modal open onClose={() => {}} mobileStyle="full-screen" showCloseButton noPadding instant>
        <p>body</p>
      </Modal>,
    );
    const close = screen.getByRole('button', { name: 'Close' });
    const header = close.closest('[data-modal-header]');
    expect(header).not.toBeNull();
    expect(header?.className).toMatch(/\bsticky\b/);
    expect(header?.className).toMatch(/\btop-0\b/);
    expect(screen.getByRole('dialog').firstElementChild).toBe(header);
  });

  it('gives the close button a 44px tap area', () => {
    render(
      <Modal open onClose={() => {}} mobileStyle="full-screen" showCloseButton instant>
        x
      </Modal>,
    );
    // 32px glyph plus a pseudo element that extends it by 6px on each side.
    const cls = screen.getByRole('button', { name: 'Close' }).className;
    expect(cls).toContain('h-8');
    expect(cls).toContain('before:-inset-1.5');
  });

  it('fills the overlay instead of using a viewport-unit height', () => {
    render(
      <Modal open onClose={() => {}} mobileStyle="full-screen" showCloseButton instant>
        x
      </Modal>,
    );
    const card = screen.getByRole('dialog');
    expect(card.className).toMatch(/\bh-full\b/);
    expect(card.className).not.toMatch(/\bh-screen\b/);
  });

  it('paints a stacked dialog above every other dialog layer', () => {
    render(
      <Modal open onClose={() => {}} showCloseButton stacked instant>
        x
      </Modal>,
    );
    expect(screen.getByRole('dialog').parentElement?.className).toContain('z-auth-dialog');
    expect(Z_LAYERS.authDialog).toBeGreaterThan(Z_LAYERS.dialog);
    expect(Z_LAYERS.authDialog).toBeLessThan(Z_LAYERS.slidePanel);
  });

  it('keeps the modal layer above the header, search, map and tab bar layers', () => {
    for (const below of [
      Z_LAYERS.chrome,
      Z_LAYERS.searchBar,
      Z_LAYERS.searchBarMorphGhost,
      Z_LAYERS.searchOverlay,
      Z_LAYERS.mapExpanded,
    ]) {
      expect(Z_LAYERS.dialog).toBeGreaterThan(below);
    }
    render(
      <Modal open onClose={() => {}} instant ariaLabel="x">
        x
      </Modal>,
    );
    expect(screen.getByRole('dialog').parentElement?.className).toContain('z-dialog');
    const tabBar = readFileSync(join(__dirname, 'MobileTabBar.tsx'), 'utf8');
    expect(tabBar).toContain('z-chrome');
  });

  it('shows a close button on the full-page sign-in', () => {
    render(<StandaloneAuth />);
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('uses no 100vh height in the dialog source files', () => {
    const files = [
      'Modal.tsx',
      'AuthModalWrapper.tsx',
      'StandaloneAuth.tsx',
      'AuthForm.tsx',
      'FilterModal.tsx',
      'SettingsSheet.tsx',
      'SlidePanel.tsx',
      'listing/ListingModalFrame.tsx',
      'listing/BuyerAgentRequestDialog.tsx',
    ];
    for (const file of files) {
      const src = readFileSync(join(__dirname, file), 'utf8');
      expect({ file, hit: src.match(/\b(?:min-|max-)?h-screen\b|\b\d+vh\b/g) }).toEqual({
        file,
        hit: null,
      });
    }
  });
});
