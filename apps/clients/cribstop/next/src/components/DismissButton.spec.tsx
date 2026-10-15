import { fireEvent, render, screen } from '@testing-library/react';
import DismissButton from './DismissButton';

describe('DismissButton', () => {
  it('is a 32px borderless, fill-free control with a 44px tap area', () => {
    const onClick = jest.fn();
    render(<DismissButton onClick={onClick} />);
    const button = screen.getByRole('button', { name: 'Close' });

    expect(button).toHaveClass('h-8', 'w-8', 'border-0', 'bg-transparent', 'hover:bg-gray-100');
    expect(button.className).toContain('before:-inset-1.5');
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
