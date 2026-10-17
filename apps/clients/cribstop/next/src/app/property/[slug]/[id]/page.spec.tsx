/**
 * #587: a hard load of a property page with a listing renders the listing modal over the city
 * search, as a soft open does. Only an off-market property keeps the full page.
 */
import { loadPropertyPage } from '@/lib/api/property-page';
import { aPropertyPage } from '@/test/fixtures';
import HydratedListing from '@/lib/query/HydratedListing';
import PropertyRoute from './page';

jest.mock('next/navigation', () => ({
  notFound: jest.fn(),
  permanentRedirect: jest.fn(),
}));

jest.mock('@/lib/api/property-page', () => ({
  loadPropertyPage: jest.fn(),
  loadPropertyByHomeId: jest.fn(),
}));

jest.mock('@/components/listing/StandaloneListingView', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/listing/PropertyPageView', () => ({
  __esModule: true,
  default: () => null,
  PropertyHistory: () => null,
}));

const mockedLoad = loadPropertyPage as jest.Mock;
const ID = '11111111-1111-4111-8111-111111111111';

async function render(page: ReturnType<typeof aPropertyPage>) {
  mockedLoad.mockResolvedValue({ status: 'ready', page });
  return PropertyRoute({ params: Promise.resolve({ slug: page.slug, id: ID }) });
}

describe('PropertyRoute hard load', () => {
  it('renders the modal over the listing city search when the property has a listing', async () => {
    const wrapper = await render(aPropertyPage());
    // The page is a fragment: the JSON-LD block (null here, no SITE_ORIGIN) and the modal.
    // The listing reaches the client through the hydrated query cache, once, not as a prop.
    const hydrated = wrapper.props.children[1];
    expect(hydrated.type).toBe(HydratedListing);
    const element = hydrated.props.children;

    expect(element.type.name).toBe('default');
    expect(element.props.id).toBe(ID);
    expect(element.props.initialState).toBeUndefined();
    const query = new URLSearchParams(element.props.cityQuery);
    expect(query.get('city')).toBe(hydrated.props.listing.city);
    expect(query.get('state')).toBe(hydrated.props.listing.state);
    expect(element.props.statusLabel).toBe('Active');
  });

  it('keeps the full page for an off-market property', async () => {
    const element = await render(aPropertyPage({ marketStatus: 'Off market' }));

    expect(element.props.page).toBeDefined();
    expect(element.props.cityQuery).toBeUndefined();
  });
});
