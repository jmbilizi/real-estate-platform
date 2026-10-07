import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LEAD_STATUSES, type StaffLeadMetrics } from '@cribstop/property-contracts';
import LeadMetrics from './LeadMetrics';
import * as api from '@/lib/api/staff-leads';

jest.mock('@/lib/api/staff-leads', () => ({
  ...jest.requireActual('@/lib/api/staff-leads'),
  fetchLeadMetrics: jest.fn(),
}));
const fetchLeadMetrics = api.fetchLeadMetrics as jest.Mock;

const NONE = { sampleSize: 0, medianSeconds: null, p90Seconds: null };
const metrics = (over: Partial<StaffLeadMetrics> = {}): StaffLeadMetrics => ({
  range: { from: null, to: null },
  total: 0,
  byStatus: Object.fromEntries(LEAD_STATUSES.map((s) => [s, 0])) as StaffLeadMetrics['byStatus'],
  byKind: { message: 0, tour_request: 0 },
  aging: { thresholdHours: 24, count: 0 },
  timeToVerify: NONE,
  timeToAssign: NONE,
  timeToAccept: NONE,
  ...over,
});

beforeEach(() => fetchLeadMetrics.mockReset());

it('shows a skeleton, then the tiles with the median and the 90th percentile', async () => {
  fetchLeadMetrics.mockResolvedValue(
    metrics({
      total: 7,
      byStatus: { ...metrics().byStatus, new: 3, verified: 4 },
      byKind: { message: 6, tour_request: 1 },
      aging: { thresholdHours: 24, count: 2 },
      timeToVerify: { sampleSize: 5, medianSeconds: 1200, p90Seconds: 12_000 },
    }),
  );
  render(<LeadMetrics />);
  expect(screen.getByTestId('lead-metrics-skeleton')).toBeInTheDocument();
  expect(await screen.findByText('20m')).toBeInTheDocument();
  expect(screen.getByText(/90th percentile 3h 20m\. 5 requests/)).toBeInTheDocument();
  expect(screen.getByText('7')).toBeInTheDocument();
  expect(screen.getByText('New or Verified for over 24h')).toBeInTheDocument();
  expect(screen.getByText('New 3')).toBeInTheDocument();
  // A step with no data shows a dash and no number.
  expect(screen.getAllByText('—')).toHaveLength(2);
  expect(screen.getAllByText('No data yet')).toHaveLength(2);
});

it('shows an empty state when there are no requests', async () => {
  fetchLeadMetrics.mockResolvedValue(metrics());
  render(<LeadMetrics />);
  expect(await screen.findByText('No requests in this period.')).toBeInTheDocument();
  expect(screen.queryByText('Aging')).toBeNull();
});

it('asks again with a start time when the period changes', async () => {
  fetchLeadMetrics.mockResolvedValue(metrics());
  render(<LeadMetrics />);
  await screen.findByText('No requests in this period.');
  expect(fetchLeadMetrics).toHaveBeenLastCalledWith({});
  fireEvent.change(screen.getByLabelText('Metrics period'), { target: { value: '7' } });
  await waitFor(() => expect(fetchLeadMetrics).toHaveBeenCalledTimes(2));
  expect(fetchLeadMetrics.mock.calls[1][0].from).toEqual(expect.any(String));
});

it('shows an error with a retry', async () => {
  fetchLeadMetrics.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(metrics());
  render(<LeadMetrics />);
  expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('No requests in this period.')).toBeInTheDocument();
});
