import { render, screen } from '@testing-library/react';
import ListingImage from './ListingImage';
import { listingPhotoAlt } from '@/lib/listing-format';

const media = { url: 'https://example.com/a.jpg', altText: null };

describe('ListingImage', () => {
  it('loads a priority image eagerly with a size and high fetch priority', () => {
    render(<ListingImage media={media} priority fallbackAlt="Photo" />);
    const img = screen.getByAltText('Photo');
    expect(img).toHaveAttribute('loading', 'eager');
    expect(img).toHaveAttribute('fetchpriority', 'high');
    expect(img).toHaveAttribute('width');
    expect(img).toHaveAttribute('height');
  });

  it('keeps other images lazy', () => {
    render(<ListingImage media={media} fallbackAlt="Photo" />);
    const img = screen.getByAltText('Photo');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).not.toHaveAttribute('fetchpriority');
  });

  it('prefers the media altText over the fallback', () => {
    render(<ListingImage media={{ ...media, altText: 'Kitchen' }} fallbackAlt="Photo" />);
    expect(screen.getByAltText('Kitchen')).toBeInTheDocument();
  });
});

describe('listingPhotoAlt', () => {
  it('builds alt from facts', () => {
    expect(listingPhotoAlt({ beds: 3, propertyType: 'Single Family', city: 'FREDERICK' })).toBe(
      'Photo of a 3 bed home in Frederick',
    );
    expect(listingPhotoAlt({ beds: null, propertyType: 'Condo', city: 'Bethesda' })).toBe(
      'Photo of a condo in Bethesda',
    );
    expect(listingPhotoAlt({ beds: null, propertyType: 'Land', city: 'Bethesda' })).toBe(
      'Land in Bethesda',
    );
  });

  it('skips the bed count for a studio', () => {
    expect(listingPhotoAlt({ beds: 0, propertyType: 'Condo', city: 'Bethesda' })).toBe(
      'Photo of a condo in Bethesda',
    );
  });

  it('never carries a street line', () => {
    const row = {
      beds: 2,
      propertyType: 'Townhome',
      city: 'Frederick',
      address: '420 Herringbone Way',
    };
    expect(listingPhotoAlt(row)).not.toMatch(/Herringbone|420/);
  });
});
