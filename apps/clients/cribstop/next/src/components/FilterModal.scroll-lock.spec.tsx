import { render } from '@testing-library/react';
import FilterModal from './FilterModal';

jest.mock('@/components/FilterModalContent', () => ({
  __esModule: true,
  default: () => <input aria-label="Min price" />,
}));

describe('FilterModal scroll lock (#758)', () => {
  const root = document.documentElement;

  it('locks the root like Modal does and leaves the body alone', () => {
    const view = render(
      <FilterModal onClose={jest.fn()} filters={{}} onChange={jest.fn()} resultCount={0} />,
    );
    expect(root.style.overflow).toBe('hidden');
    expect(document.body.style.overflow).toBe('');
    jest.useFakeTimers();
    view.unmount();
    jest.runAllTimers();
    jest.useRealTimers();
    expect(root.style.overflow).toBe('');
    expect(root.style.scrollbarGutter).toBe('');
  });
});
