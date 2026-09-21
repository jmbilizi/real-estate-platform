import { fireEvent, render, screen } from '@testing-library/react';
import Button, { IconButton } from './Button';

describe('Button', () => {
  it('renders its label and responds to a click', () => {
    const onClick = jest.fn();
    render(<Button onClick={onClick}>Try again</Button>);

    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('disables the control while loading', () => {
    render(<Button isLoading>Saving</Button>);
    expect(screen.getByRole('button', { name: /Saving/ })).toBeDisabled();
  });
});

describe('IconButton', () => {
  it('requires an accessible label', () => {
    render(
      <IconButton aria-label="Close">
        <span>x</span>
      </IconButton>,
    );
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });
});
