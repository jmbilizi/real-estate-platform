import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LookingForSection from './LookingForSection';
import {
  deleteLookingFor,
  getLookingFor,
  type LookingFor,
  LookingForError,
  saveLookingFor,
} from '@/lib/api/looking-for';

jest.mock('@/lib/api/looking-for', () => ({
  ...jest.requireActual('@/lib/api/looking-for'),
  getLookingFor: jest.fn(),
  saveLookingFor: jest.fn(),
  deleteLookingFor: jest.fn(),
}));

const mockGet = getLookingFor as jest.MockedFunction<typeof getLookingFor>;
const mockSave = saveLookingFor as jest.MockedFunction<typeof saveLookingFor>;
const mockDelete = deleteLookingFor as jest.MockedFunction<typeof deleteLookingFor>;

const item = (over: Partial<LookingFor> = {}): LookingFor => ({
  id: '11111111-1111-4111-8111-111111111111',
  intent: 'buy',
  places: [{ kind: 'city', city: 'Alexandria', state: 'VA' }],
  priceMin: 400000,
  priceMax: 900000,
  bedsMin: 2,
  bathsMin: null,
  homeTypes: ['Condo'],
  whenStart: null,
  whenEnd: null,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  ...over,
});

describe('LookingForSection', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    Object.defineProperty(globalThis, 'crypto', {
      value: { randomUUID: () => '22222222-2222-4222-8222-222222222222' },
      configurable: true,
    });
  });

  it('shows the skeleton while loading, then the list', async () => {
    mockGet.mockResolvedValue({ items: [item()], max: 5 });
    render(<LookingForSection />);
    expect(screen.getByTestId('looking-for-skeleton')).toBeInTheDocument();
    expect(await screen.findByText(/Buy: Alexandria, VA/)).toBeInTheDocument();
    expect(screen.queryByTestId('looking-for-skeleton')).not.toBeInTheDocument();
    expect(screen.getByText('Bedrooms: 2+')).toBeInTheDocument();
  });

  it('states that the preference sets no email', async () => {
    mockGet.mockResolvedValue({ items: [], max: 5 });
    render(<LookingForSection />);
    expect(await screen.findByText(/sets no email yet/i)).toBeInTheDocument();
  });

  it('offers a retry when the load fails', async () => {
    mockGet.mockRejectedValueOnce(new LookingForError(500, 'failed'));
    render(<LookingForSection />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load');
    mockGet.mockResolvedValue({ items: [], max: 5 });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No preferences yet.')).toBeInTheDocument();
  });

  it('adds a preference with the entered facts', async () => {
    mockGet.mockResolvedValue({ items: [], max: 5 });
    mockSave.mockImplementation(async (id, input) => ({ ...item(), ...input, id }) as LookingFor);
    render(<LookingForSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));

    fireEvent.change(screen.getByLabelText('City 1'), { target: { value: 'Arlington' } });
    fireEvent.change(screen.getByLabelText('State 1'), { target: { value: 'va' } });
    fireEvent.change(screen.getByLabelText('Maximum price'), { target: { value: '750000' } });
    fireEvent.change(screen.getByLabelText('Bedrooms'), { target: { value: '3' } });
    fireEvent.click(screen.getByLabelText('Condo'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    expect(mockSave).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222', {
      intent: 'buy',
      places: [{ kind: 'city', state: 'VA', city: 'Arlington' }],
      priceMin: null,
      priceMax: 750000,
      bedsMin: 3,
      bathsMin: null,
      homeTypes: ['Condo'],
      whenStart: null,
      whenEnd: null,
    });
    expect(await screen.findByText(/Buy: Arlington, VA/)).toBeInTheDocument();
  });

  it('keeps Save off until a city and state exist', async () => {
    mockGet.mockResolvedValue({ items: [], max: 5 });
    render(<LookingForSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('has no free-text field for anything but place names', async () => {
    mockGet.mockResolvedValue({ items: [], max: 5 });
    render(<LookingForSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    expect(screen.queryByRole('textbox', { name: /note|comment|family|school/i })).toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('opens the date picker and saves a chosen date', async () => {
    mockGet.mockResolvedValue({ items: [], max: 5 });
    mockSave.mockImplementation(async (id, input) => ({ ...item(), ...input, id }) as LookingFor);
    render(<LookingForSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByLabelText('City 1'), { target: { value: 'Arlington' } });
    fireEvent.change(screen.getByLabelText('State 1'), { target: { value: 'VA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Choose date' }));
    expect(screen.queryByText('Any time')).not.toBeInTheDocument();

    // The last day of this month is never in the past. Two clicks on one day pick a single date.
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    const iso = `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`;
    fireEvent.click(screen.getAllByRole('button', { name: String(last.getDate()) })[0]);
    fireEvent.click(screen.getAllByRole('button', { name: String(last.getDate()) })[0]);
    expect(screen.getByText(iso)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mockSave).toHaveBeenCalled());
    expect(mockSave.mock.calls[0][1]).toMatchObject({ whenStart: iso, whenEnd: null });
  });

  it('refuses a sixth preference with the limit message', async () => {
    mockGet.mockResolvedValue({ items: [item()], max: 5 });
    mockSave.mockRejectedValue(new LookingForError(409, 'limit_reached'));
    render(<LookingForSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit buy preference' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('up to 5');
  });

  it('hides Add at the limit', async () => {
    mockGet.mockResolvedValue({
      items: Array.from({ length: 5 }, (_, i) => item({ id: `id-${i}` })),
      max: 5,
    });
    render(<LookingForSection />);
    await screen.findAllByText(/Buy: Alexandria, VA/);
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  });

  it('deletes a preference', async () => {
    mockGet.mockResolvedValue({ items: [item()], max: 5 });
    mockDelete.mockResolvedValue();
    render(<LookingForSection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete buy preference' }));
    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith(item().id));
    expect(await screen.findByText('No preferences yet.')).toBeInTheDocument();
  });
});
