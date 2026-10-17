import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import NewDeviceCodeSetting from './NewDeviceCodeSetting';
import {
  CodesUnavailableError,
  getNewDeviceSetting,
  RateLimitError,
  removeTrustedDevice,
  setNewDeviceSetting,
} from '@/lib/api/account';

jest.mock('@/lib/api/account', () => ({
  ...jest.requireActual('@/lib/api/account'),
  getNewDeviceSetting: jest.fn(),
  setNewDeviceSetting: jest.fn(),
  removeTrustedDevice: jest.fn(),
}));

const mockGet = getNewDeviceSetting as jest.MockedFunction<typeof getNewDeviceSetting>;
const mockSet = setNewDeviceSetting as jest.MockedFunction<typeof setNewDeviceSetting>;
const mockRemove = removeTrustedDevice as jest.MockedFunction<typeof removeTrustedDevice>;

const DEVICE = {
  id: '11111111-1111-1111-1111-111111111111',
  label: 'Chrome on Windows',
  firstSeenAt: '2026-10-01T10:00:00Z',
  lastUsedAt: '2026-10-12T10:00:00Z',
  current: true,
};
const LABEL = 'Ask for an email code when I sign in on a new device';

async function show(setting = { enabled: false, devices: [] as (typeof DEVICE)[] }) {
  mockGet.mockResolvedValue(setting);
  render(
    <ul>
      <NewDeviceCodeSetting />
    </ul>,
  );
  await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled());
}

describe('NewDeviceCodeSetting', () => {
  beforeEach(() => jest.resetAllMocks());

  it('is off by default and shows no device list', async () => {
    await show();

    expect(screen.getByRole('switch', { name: new RegExp(LABEL) })).not.toBeChecked();
    expect(screen.queryByText('Approved devices')).not.toBeInTheDocument();
  });

  it('asks for the password before it turns the setting on', async () => {
    await show();

    fireEvent.click(screen.getByRole('switch'));

    expect(screen.getByLabelText(/Confirm your password to turn this on/)).toHaveFocus();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('turns it on with the password, then reloads the list', async () => {
    mockSet.mockResolvedValue({ ok: true, enabled: true });
    await show();
    mockGet.mockResolvedValue({ enabled: true, devices: [DEVICE] });

    fireEvent.click(screen.getByRole('switch'));
    fireEvent.change(screen.getByLabelText(/Confirm your password/), { target: { value: ' pw ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    await waitFor(() => expect(mockSet).toHaveBeenCalledWith(true, ' pw '));
    expect(await screen.findByText('Chrome on Windows')).toBeInTheDocument();
    expect(screen.getByText('This device')).toBeInTheDocument();
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('keeps the prompt open and clears the password after a wrong password', async () => {
    mockSet.mockResolvedValue({ ok: false, reason: 'wrong_password' });
    await show();

    fireEvent.click(screen.getByRole('switch'));
    fireEvent.change(screen.getByLabelText(/Confirm your password/), { target: { value: 'bad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    expect(await screen.findByText('That password did not work.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Confirm your password/)).toHaveValue('');
  });

  it('shows the wait after a lock', async () => {
    mockSet.mockRejectedValue(new RateLimitError(120));
    await show();

    fireEvent.click(screen.getByRole('switch'));
    fireEvent.change(screen.getByLabelText(/Confirm your password/), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    expect(await screen.findByText(/Try again in 120 seconds/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeDisabled();
  });

  it('shows the unavailable copy when codes cannot send', async () => {
    mockSet.mockRejectedValue(new CodesUnavailableError());
    await show();

    fireEvent.click(screen.getByRole('switch'));
    fireEvent.change(screen.getByLabelText(/Confirm your password/), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));

    expect(await screen.findByText(/Email codes are unavailable right now/)).toBeInTheDocument();
  });

  it('cancel closes the prompt and leaves the switch as it was', async () => {
    await show();

    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByLabelText(/Confirm your password/)).not.toBeInTheDocument();
    expect(screen.getByRole('switch')).not.toBeChecked();
  });

  it('lists each device with first seen and last used, and signs one out', async () => {
    mockRemove.mockResolvedValue(undefined);
    await show({ enabled: true, devices: [DEVICE] });

    expect(screen.getByText(/First seen .*2026.*Last used .*2026/)).toBeInTheDocument();
    mockGet.mockResolvedValue({ enabled: true, devices: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Sign out Chrome on Windows' }));

    await waitFor(() => expect(mockRemove).toHaveBeenCalledWith(DEVICE.id));
    expect(await screen.findByText('No approved devices.')).toBeInTheDocument();
  });

  it('offers a retry when the setting does not load', async () => {
    mockGet.mockRejectedValueOnce(new Error('down'));
    render(
      <ul>
        <NewDeviceCodeSetting />
      </ul>,
    );

    expect(await screen.findByText(/We could not load this setting/)).toBeInTheDocument();
    mockGet.mockResolvedValue({ enabled: false, devices: [] });
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));

    await waitFor(() => expect(screen.getByRole('switch')).not.toBeDisabled());
  });
});
