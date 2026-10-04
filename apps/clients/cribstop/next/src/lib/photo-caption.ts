import type { DetailMedia } from '@cribstop/property-contracts';

/** "Photo 3", "Image #12", "IMG_0042", "3", "Picture 3 of 20". None of these describe the photo. */
const GENERIC_NUMBERED =
  /^(?:(?:photo|image|picture|pic|img|slide|listing photo)s?[\s_#-]*)?\d+(?:\s*of\s*\d+)?$/;
const GENERIC_WORD = /^(?:photo|image|picture|pic|img|listing photo|main photo|primary photo)s?$/;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGeneric(text: string): boolean {
  const norm = normalize(text);
  return norm === '' || GENERIC_NUMBERED.test(norm) || GENERIC_WORD.test(norm);
}

/** The short description is a real one when it is not a generic label and not the address. */
function isRealShortDescription(text: string, address: string | null): boolean {
  if (isGeneric(text)) {
    return false;
  }
  const street = address ? normalize(address) : '';
  return street === '' || !normalize(text).includes(street);
}

/**
 * The text the gallery shows for one photo (#600): the long description, else the short
 * description when it is a real one, else null. The service already nulls both fields on an
 * address-suppressed listing (#105), so this function never adds text back.
 */
export function photoCaption(photo: DetailMedia, address: string | null): string | null {
  const long = photo.caption?.trim();
  if (long && !isGeneric(long)) {
    return long;
  }
  const short = photo.altText?.trim();
  return short && isRealShortDescription(short, address) ? short : null;
}
