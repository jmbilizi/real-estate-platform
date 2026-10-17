import { useQuery } from '@tanstack/react-query';
import { screen } from '@testing-library/react';
import { renderWithClient } from './renderWithClient';

function Probe({ fn }: { fn: () => Promise<string> }) {
  const { data, isError } = useQuery({ queryKey: ['probe'], queryFn: fn });
  return <p>{isError ? 'failed' : (data ?? 'loading')}</p>;
}

describe('renderWithClient', () => {
  it('renders a fetching component', async () => {
    renderWithClient(<Probe fn={async () => 'ready'} />);
    expect(await screen.findByText('ready')).toBeInTheDocument();
  });

  it('does not retry a failed query', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'));
    renderWithClient(<Probe fn={fn} />);
    expect(await screen.findByText('failed')).toBeInTheDocument();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives each call its own cache', async () => {
    const first = renderWithClient(<Probe fn={async () => 'one'} />);
    await screen.findByText('one');
    first.unmount();
    const second = renderWithClient(<Probe fn={async () => 'two'} />);
    expect(second.client).not.toBe(first.client);
    expect(await screen.findByText('two')).toBeInTheDocument();
  });
});
