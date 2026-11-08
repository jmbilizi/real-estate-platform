import { fireEvent, render, screen } from '@testing-library/react';
import ResultsPager from './ResultsPager';

const hrefFor = (p: number) => `/a/homes-for-sale${p === 1 ? '' : `?page=${p}`}`;

describe('ResultsPager (#847)', () => {
  it('renders crawlable links when it has hrefFor', () => {
    render(<ResultsPager page={2} pageCount={4} onPage={jest.fn()} hrefFor={hrefFor} />);
    expect(screen.getByRole('link', { name: 'Previous page' })).toHaveAttribute(
      'href',
      '/a/homes-for-sale',
    );
    expect(screen.getByRole('link', { name: 'Next page' })).toHaveAttribute(
      'href',
      '/a/homes-for-sale?page=3',
    );
    expect(screen.getByRole('link', { name: '4' })).toHaveAttribute(
      'href',
      '/a/homes-for-sale?page=4',
    );
  });

  it('moves the page on a plain click without navigating', () => {
    const onPage = jest.fn();
    render(<ResultsPager page={1} pageCount={3} onPage={onPage} hrefFor={hrefFor} />);
    const notPrevented = fireEvent.click(screen.getByRole('link', { name: '3' }));
    expect(notPrevented).toBe(false);
    expect(onPage).toHaveBeenCalledWith(3);
  });

  it('leaves a modified click to the browser', () => {
    const onPage = jest.fn();
    render(<ResultsPager page={1} pageCount={3} onPage={onPage} hrefFor={hrefFor} />);
    fireEvent.click(screen.getByRole('link', { name: '3' }), { ctrlKey: true });
    expect(onPage).not.toHaveBeenCalled();
  });

  it('renders buttons without hrefFor', () => {
    render(<ResultsPager page={1} pageCount={3} onPage={jest.fn()} />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getByRole('button', { name: '2' })).toBeInTheDocument();
  });

  it('disables the edge controls', () => {
    render(<ResultsPager page={1} pageCount={3} onPage={jest.fn()} hrefFor={hrefFor} />);
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  });
});
