import { photoCaption } from './photo-caption';

const photo = (altText: string | null, caption: string | null) => ({
  url: 'https://example.com/a.jpg',
  altText,
  caption,
});
const ADDRESS = '12 Oak St';

describe('photoCaption (#600)', () => {
  it('shows the long description first', () => {
    expect(photoCaption(photo('Kitchen', 'Updated kitchen with quartz counters'), ADDRESS)).toBe(
      'Updated kitchen with quartz counters',
    );
  });

  it('falls back to a real short description', () => {
    expect(photoCaption(photo('Kitchen', null), ADDRESS)).toBe('Kitchen');
    expect(photoCaption(photo('Kitchen', '   '), ADDRESS)).toBe('Kitchen');
  });

  it.each(['Photo 3', 'photo3', 'Image #12', 'IMG_0042', '7', 'Picture 3 of 20', 'Photo', ' '])(
    'drops the generic value %j',
    (altText) => {
      expect(photoCaption(photo(altText, null), ADDRESS)).toBeNull();
    },
  );

  it('drops a short description that is the address', () => {
    expect(photoCaption(photo('12 Oak St.', null), ADDRESS)).toBeNull();
    expect(photoCaption(photo('Front of 12 Oak St', null), ADDRESS)).toBeNull();
  });

  it('drops a generic long description and falls through to the short one', () => {
    expect(photoCaption(photo('Pool', 'Photo 4'), ADDRESS)).toBe('Pool');
  });

  it('shows nothing when both are null', () => {
    expect(photoCaption(photo(null, null), ADDRESS)).toBeNull();
    expect(photoCaption(photo(null, null), null)).toBeNull();
  });
});
