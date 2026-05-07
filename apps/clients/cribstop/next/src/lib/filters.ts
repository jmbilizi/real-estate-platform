import type { Listing, SearchFilters } from "./types";

export function applyFilters(listings: Listing[], filters: SearchFilters): Listing[] {
  let result = [...listings];

  // Precise zip filter (e.g. user searched "22314")
  if (filters.zip) {
    const zip = filters.zip.trim();
    result = result.filter((l) => l.zip === zip || l.zip.startsWith(zip));
  }

  // Precise street filter (e.g. user searched "King St")
  if (filters.street) {
    const street = filters.street.toLowerCase();
    result = result.filter((l) => l.address.toLowerCase().includes(street));
  }

  // General query — runs only when no precise zip/street was resolved
  if (filters.query && !filters.zip && !filters.street) {
    const q = filters.query.toLowerCase();
    result = result.filter(
      (l) =>
        l.title.toLowerCase().includes(q) ||
        l.address.toLowerCase().includes(q) ||
        l.city.toLowerCase().includes(q) ||
        l.neighborhood.toLowerCase().includes(q) ||
        l.zip.includes(q),
    );
  }

  if (filters.listingType && filters.listingType !== "all") {
    result = result.filter((l) => l.listingType === filters.listingType);
  }

  if (filters.propertyType && filters.propertyType !== "all") {
    result = result.filter((l) => l.propertyType === filters.propertyType);
  }

  if (typeof filters.minPrice === "number") {
    result = result.filter((l) => l.price >= filters.minPrice!);
  }
  if (typeof filters.maxPrice === "number") {
    result = result.filter((l) => l.price <= filters.maxPrice!);
  }

  if (filters.beds && filters.beds > 0) {
    result = result.filter((l) => l.beds >= filters.beds!);
  }
  if (filters.baths && filters.baths > 0) {
    result = result.filter((l) => l.baths >= filters.baths!);
  }
  if (filters.minSqft && filters.minSqft > 0) {
    result = result.filter((l) => l.sqft >= filters.minSqft!);
  }

  if (filters.neighborhood) {
    result = result.filter((l) => l.neighborhood.toLowerCase() === filters.neighborhood!.toLowerCase());
  }

  if (filters.openHouse) result = result.filter((l) => !!l.openHouse);
  if (filters.newConstruction) result = result.filter((l) => !!l.newConstruction);
  if (filters.waterfront) result = result.filter((l) => l.amenities.includes("Waterfront"));
  if (filters.petFriendly) result = result.filter((l) => l.amenities.includes("Pet Friendly"));

  if (filters.amenities && filters.amenities.length > 0) {
    result = result.filter((l) => filters.amenities!.every((a) => l.amenities.includes(a)));
  }

  switch (filters.sort) {
    case "newest":
      result.sort((a, b) => +new Date(b.lastUpdated) - +new Date(a.lastUpdated));
      break;
    case "price-asc":
      result.sort((a, b) => a.price - b.price);
      break;
    case "price-desc":
      result.sort((a, b) => b.price - a.price);
      break;
    default:
      result.sort((a, b) => Number(b.featured) - Number(a.featured));
  }

  return result;
}
