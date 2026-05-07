import { Listing } from "./types";

// Curated real-estate / interior photography from Unsplash (verified photo IDs with slugs).
const PHOTOS = [
  "photo-1600596542815-ffad4c1539a9", // modern house exterior
  "photo-1600585154340-be6161a56a0c", // modern living room
  "photo-1600607687939-ce8a6c25118c", // luxury kitchen
  "photo-1502672260266-1c1ef2d93688", // white modern interior
  "photo-1560448204-e02f11c3d0e2", // bright bedroom
  "photo-1613490493576-7fde63acd811", // waterfront villa
  "photo-1512917774080-9991f1c4c750", // dream home exterior
  "photo-1580587771525-78b9dba3b914", // elegant home
  "photo-1570129477492-45c003edd2be", // townhome exterior
  "photo-1568605114967-8130f3a36994", // modern family home
  "photo-1598228723793-52759bba239c", // condo interior
  "photo-1522708323590-d24dbb6b0267", // cozy living room
  "photo-1512918728675-ed5a9ecdebfd", // new construction
  "photo-1564013799919-ab600027ffc6", // suburban home
  "photo-1600566753190-17f0baa2a6c3", // modern loft
  "photo-1600047509807-ba8f99d2cdde", // luxury penthouse
];

const IMG = (i: number) =>
  `https://images.unsplash.com/${PHOTOS[i % PHOTOS.length]}?w=1200&h=800&fit=crop&auto=format&q=80`;

let listings: Listing[] = [
  {
    id: "1",
    title: "Modern Waterfront Estate",
    address: "1200 Harbor View Dr",
    city: "Annapolis",
    state: "MD",
    zip: "21401",
    neighborhood: "Eastport",
    price: 1295000,
    status: "Active",
    listingType: "sale",
    propertyType: "Single Family",
    beds: 5,
    baths: 4,
    sqft: 4200,
    lotSqft: 10890,
    yearBuilt: 2019,
    imageUrls: [IMG(1600596542815), IMG(1600585154340), IMG(1600607687939), IMG(1560448204771)],
    brokerName: "Sarah Mitchell",
    brokerPhone: "(410) 555-0190",
    brokerEmail: "sarah@realbroker.com",
    officeName: "Real Broker LLC",
    lastUpdated: "2026-04-18T10:30:00Z",
    description:
      "Stunning waterfront estate with panoramic views of the Chesapeake Bay. This meticulously designed home features an open floor plan, gourmet kitchen with Sub-Zero appliances, primary suite with private balcony, and a resort-style backyard with infinity pool. Deep-water dock with boat lift included.",
    amenities: ["Pool", "Waterfront", "Garage", "Smart Home", "Fireplace", "Garden", "Balcony"],
    latitude: 38.9784,
    longitude: -76.4922,
    featured: true,
    openHouse: { date: "2026-04-26", startTime: "1:00 PM", endTime: "4:00 PM" },
    priceReduced: false,
    newConstruction: false,
    listedBy: "Sarah Mitchell – Real Broker LLC",
  },
  {
    id: "2",
    title: "Luxury Downtown Condo",
    address: "800 F St NW Unit 1201",
    city: "Washington",
    state: "DC",
    zip: "20004",
    neighborhood: "Penn Quarter",
    price: 875000,
    status: "Active",
    listingType: "sale",
    propertyType: "Condo",
    beds: 2,
    baths: 2,
    sqft: 1450,
    yearBuilt: 2021,
    imageUrls: [IMG(1502672260266), IMG(1560448204771), IMG(1600585154340), IMG(1600607687939)],
    brokerName: "James Carter",
    brokerPhone: "(202) 555-0234",
    brokerEmail: "james@realbroker.com",
    officeName: "Real Broker LLC",
    lastUpdated: "2026-04-17T14:00:00Z",
    description:
      "Sleek 12th-floor condo in the heart of Penn Quarter with floor-to-ceiling windows, Bosch appliances, quartz countertops, and private balcony overlooking the city. Building amenities include rooftop pool, concierge, and fitness center. Walk to galleries, restaurants, and Metro.",
    amenities: ["Gym", "Elevator", "Balcony", "Rooftop", "Washer/Dryer", "Pet Friendly", "Smart Home"],
    latitude: 38.8977,
    longitude: -77.0235,
    featured: true,
    priceReduced: true,
    listedBy: "James Carter – Real Broker LLC",
  },
  {
    id: "3",
    title: "Charming Federal Hill Townhome",
    address: "234 Warren Ave",
    city: "Baltimore",
    state: "MD",
    zip: "21230",
    neighborhood: "Federal Hill",
    price: 425000,
    status: "Active",
    listingType: "sale",
    propertyType: "Townhome",
    beds: 3,
    baths: 2.5,
    sqft: 1800,
    yearBuilt: 1920,
    imageUrls: [IMG(1600585154340), IMG(1600596542815), IMG(1502672260266), IMG(1600607687939)],
    brokerName: "Maria Lopez",
    brokerPhone: "(443) 555-0167",
    brokerEmail: "maria@realbroker.com",
    officeName: "Real Broker LLC",
    lastUpdated: "2026-04-16T09:15:00Z",
    description:
      "Beautifully renovated Federal Hill townhome blending historic charm with modern finishes. Exposed brick, hardwood floors throughout, chef's kitchen, and a private rooftop deck with city views. Steps from Cross Street Market and the Inner Harbor.",
    amenities: ["Fireplace", "Rooftop", "Washer/Dryer", "Pet Friendly", "Garden"],
    latitude: 39.2754,
    longitude: -76.6122,
    featured: false,
    openHouse: { date: "2026-04-27", startTime: "11:00 AM", endTime: "1:00 PM" },
    listedBy: "Maria Lopez – Real Broker LLC",
  },
  {
    id: "4",
    title: "Brand New Bethesda Residence",
    address: "7801 Old Georgetown Rd",
    city: "Bethesda",
    state: "MD",
    zip: "20814",
    neighborhood: "Downtown Bethesda",
    price: 1650000,
    status: "Active",
    listingType: "sale",
    propertyType: "New Construction",
    beds: 4,
    baths: 3.5,
    sqft: 3600,
    lotSqft: 6500,
    yearBuilt: 2026,
    imageUrls: [IMG(1600607687939), IMG(1600596542815), IMG(1560448204771), IMG(1502672260266)],
    brokerName: "David Kim",
    brokerPhone: "(301) 555-0312",
    brokerEmail: "david@realbroker.com",
    officeName: "Real Broker LLC",
    lastUpdated: "2026-04-19T16:45:00Z",
    description:
      "Just completed! This stunning new construction home in Downtown Bethesda offers the finest modern living. Features include 10-foot ceilings, designer finishes, Thermador appliance package, spa-like primary bath, and a two-car garage. Smart home technology throughout. Walk to Metro, shops, and dining.",
    amenities: ["Garage", "Smart Home", "EV Charging", "Solar", "Balcony", "Office", "Garden"],
    latitude: 38.9847,
    longitude: -77.0947,
    featured: true,
    newConstruction: true,
    listedBy: "David Kim – Real Broker LLC",
  },
  {
    id: "5",
    title: "Cozy Capitol Hill Rental",
    address: "512 E Capitol St SE",
    city: "Washington",
    state: "DC",
    zip: "20003",
    neighborhood: "Capitol Hill",
    price: 3200,
    status: "Active",
    listingType: "rent",
    propertyType: "Townhome",
    beds: 2,
    baths: 1.5,
    sqft: 1200,
    yearBuilt: 1910,
    imageUrls: [IMG(1560448204771), IMG(1600585154340), IMG(1600596542815), IMG(1600607687939)],
    brokerName: "Sarah Mitchell",
    brokerPhone: "(410) 555-0190",
    brokerEmail: "sarah@realbroker.com",
    officeName: "Real Broker LLC",
    lastUpdated: "2026-04-20T08:00:00Z",
    description:
      "Charming Capitol Hill row home available for lease. Bright living spaces, original hardwood floors, updated kitchen and bath, private patio garden. One block from Eastern Market and Metro. Pets welcome with deposit.",
    amenities: ["Washer/Dryer", "Pet Friendly", "Garden", "Fireplace"],
    latitude: 38.8868,
    longitude: -76.9996,
    featured: false,
    listedBy: "Sarah Mitchell – Real Broker LLC",
  },
  {
    id: "6",
    title: "Luxury High-Rise in Tysons",
    address: "1881 N Nash St Unit 2508",
    city: "Tysons",
    state: "VA",
    zip: "22102",
    neighborhood: "Tysons Corner",
    price: 4500,
    status: "Active",
    listingType: "rent",
    propertyType: "Condo",
    beds: 1,
    baths: 1,
    sqft: 920,
    yearBuilt: 2023,
    imageUrls: [IMG(1502672260266), IMG(1600607687939), IMG(1560448204771), IMG(1600585154340)],
    brokerName: "James Carter",
    brokerPhone: "(202) 555-0234",
    brokerEmail: "james@realbroker.com",
    officeName: "Real Broker LLC",
    lastUpdated: "2026-04-15T12:00:00Z",
    description:
      "Live above it all in this 25th-floor luxury condo with breathtaking sunset views. Premium finishes include Italian porcelain tile, custom closets, and integrated smart home controls. Resort-style amenities: infinity pool, spa, coworking lounge, sky garden. Steps from Metro Silver Line.",
    amenities: ["Pool", "Gym", "Elevator", "Rooftop", "Smart Home", "Washer/Dryer", "Pet Friendly", "Balcony"],
    latitude: 38.9176,
    longitude: -77.2205,
    featured: true,
    listedBy: "James Carter – Real Broker LLC",
  },
  {
    id: "7",
    title: "Investment Multi-Family in Hampden",
    address: "3456 Chestnut Ave",
    city: "Baltimore",
    state: "MD",
    zip: "21211",
    neighborhood: "Hampden",
    price: 620000,
    status: "Active",
    listingType: "sale",
    propertyType: "Multi-Family",
    beds: 6,
    baths: 4,
    sqft: 3200,
    yearBuilt: 1945,
    imageUrls: [IMG(1600585154340), IMG(1600596542815), IMG(1502672260266), IMG(1600607687939)],
    brokerName: "Maria Lopez",
    brokerPhone: "(443) 555-0167",
    brokerEmail: "maria@realbroker.com",
    officeName: "Real Broker LLC",
    lastUpdated: "2026-04-14T11:30:00Z",
    description:
      "Excellent investment opportunity—fully leased triplex in trendy Hampden. Each unit features 2 beds/1 bath with separate entrances, updated kitchens, and in-unit laundry. Strong rental history, low maintenance costs, and walking distance to The Avenue's shops and restaurants.",
    amenities: ["Washer/Dryer", "Garden", "Pet Friendly", "Garage"],
    latitude: 39.3309,
    longitude: -76.6368,
    featured: false,
    listedBy: "Maria Lopez – Real Broker LLC",
  },
  {
    id: "8",
    title: "Renovated Columbia Heights Flat",
    address: "1330 Kenyon St NW Apt 4",
    city: "Washington",
    state: "DC",
    zip: "20010",
    neighborhood: "Columbia Heights",
    price: 2650,
    status: "Active",
    listingType: "rent",
    propertyType: "Condo",
    beds: 1,
    baths: 1,
    sqft: 750,
    yearBuilt: 2018,
    imageUrls: [IMG(1560448204771), IMG(1600607687939), IMG(1502672260266), IMG(1600596542815)],
    brokerName: "David Kim",
    brokerPhone: "(301) 555-0312",
    brokerEmail: "david@realbroker.com",
    officeName: "Real Broker LLC",
    lastUpdated: "2026-04-19T09:00:00Z",
    description:
      "Bright and airy 1BR in the heart of Columbia Heights. Gut-renovated with wide-plank oak floors, Caesarstone counters, and Bosch combo washer/dryer. Rooftop access with grill stations and city views. Half-block to Metro, Target, and the farmers' market.",
    amenities: ["Washer/Dryer", "Rooftop", "Pet Friendly", "Elevator"],
    latitude: 38.9278,
    longitude: -77.0329,
    featured: false,
    listedBy: "David Kim – Real Broker LLC",
  },
  {
    id: "9",
    title: "Elegant Colonial in Roland Park",
    address: "501 Woodlawn Rd",
    city: "Baltimore",
    state: "MD",
    zip: "21210",
    neighborhood: "Roland Park",
    price: 899000,
    status: "Active",
    listingType: "sale",
    propertyType: "Single Family",
    beds: 5,
    baths: 3.5,
    sqft: 3800,
    lotSqft: 12000,
    yearBuilt: 1928,
    imageUrls: [IMG(1600596542815), IMG(1600585154340), IMG(1560448204771), IMG(1600607687939)],
    brokerName: "Sarah Mitchell",
    brokerPhone: "(410) 555-0190",
    brokerEmail: "sarah@realbroker.com",
    officeName: "Real Broker LLC",
    lastUpdated: "2026-04-13T15:30:00Z",
    description:
      "Timeless Roland Park colonial on a tree-lined street. Gracious living and dining rooms with original millwork, gourmet eat-in kitchen, family room addition with vaulted ceiling, and a landscaped backyard with stone patio. Top-rated schools within walking distance.",
    amenities: ["Fireplace", "Garden", "Garage", "Office"],
    latitude: 39.3629,
    longitude: -76.6334,
    featured: false,
    priceReduced: true,
    listedBy: "Sarah Mitchell – Real Broker LLC",
  },
  {
    id: "10",
    title: "Waterfront Loft in Fells Point",
    address: "1000 Fell St Loft 3B",
    city: "Baltimore",
    state: "MD",
    zip: "21231",
    neighborhood: "Fells Point",
    price: 525000,
    status: "Active",
    listingType: "sale",
    propertyType: "Loft",
    beds: 2,
    baths: 2,
    sqft: 1600,
    yearBuilt: 2017,
    imageUrls: [IMG(1502672260266), IMG(1600596542815), IMG(1600607687939), IMG(1560448204771)],
    brokerName: "James Carter",
    brokerPhone: "(202) 555-0234",
    brokerEmail: "james@realbroker.com",
    officeName: "Real Broker LLC",
    lastUpdated: "2026-04-12T13:00:00Z",
    description:
      "Industrial-chic loft in a converted waterfront warehouse. Soaring 14-foot ceilings, exposed steel beams, polished concrete floors, and walls of glass framing harbor views. Open chef's kitchen, spa bathroom, and deeded parking. Walk to the waterfront promenade, restaurants, and nightlife.",
    amenities: ["Waterfront", "Elevator", "Gym", "Balcony", "Washer/Dryer", "Pet Friendly"],
    latitude: 39.2826,
    longitude: -76.5929,
    featured: true,
    openHouse: { date: "2026-04-26", startTime: "10:00 AM", endTime: "12:00 PM" },
    listedBy: "James Carter – Real Broker LLC",
  },
  {
    id: "11",
    title: "Silver Spring Family Home",
    address: "9405 Colesville Rd",
    city: "Silver Spring",
    state: "MD",
    zip: "20901",
    neighborhood: "Downtown Silver Spring",
    price: 575000,
    status: "Active",
    listingType: "sale",
    propertyType: "Single Family",
    beds: 4,
    baths: 3,
    sqft: 2400,
    lotSqft: 8200,
    yearBuilt: 1965,
    imageUrls: [IMG(1600607687939), IMG(1600585154340), IMG(1502672260266), IMG(1600596542815)],
    brokerName: "David Kim",
    brokerPhone: "(301) 555-0312",
    brokerEmail: "david@realbroker.com",
    officeName: "Real Broker LLC",
    lastUpdated: "2026-04-11T10:00:00Z",
    description:
      "Expanded split-level in the heart of Silver Spring. Updated kitchen with island, finished lower level with rec room and full bath, fenced backyard with mature trees. Walk to DTSS restaurants, shopping, and Red Line Metro.",
    amenities: ["Garage", "Garden", "Fireplace", "Office", "Pet Friendly"],
    latitude: 38.9907,
    longitude: -77.0261,
    featured: false,
    listedBy: "David Kim – Real Broker LLC",
  },
  {
    id: "12",
    title: "Alexandria Waterfront Penthouse",
    address: "501 Slaters Ln PH1",
    city: "Alexandria",
    state: "VA",
    zip: "22314",
    neighborhood: "Old Town",
    price: 1875000,
    status: "Active",
    listingType: "sale",
    propertyType: "Condo",
    beds: 3,
    baths: 3,
    sqft: 2800,
    yearBuilt: 2022,
    imageUrls: [IMG(1600596542815), IMG(1502672260266), IMG(1600607687939), IMG(1560448204771)],
    brokerName: "Sarah Mitchell",
    brokerPhone: "(410) 555-0190",
    brokerEmail: "sarah@realbroker.com",
    officeName: "Real Broker LLC",
    lastUpdated: "2026-04-20T18:00:00Z",
    description:
      "Trophy penthouse with 270-degree Potomac River views. Wraparound terrace, custom Italian kitchen, primary suite with dual walk-in closets and freestanding soaking tub. Building offers 24-hour concierge, wine storage, and marina access. Minutes to DCA airport and Old Town's King Street.",
    amenities: ["Waterfront", "Pool", "Gym", "Elevator", "Balcony", "Rooftop", "Smart Home", "EV Charging", "Garage"],
    latitude: 38.8185,
    longitude: -77.0524,
    featured: true,
    listedBy: "Sarah Mitchell – Real Broker LLC",
  },
];

// Add more listings by duplicating and varying existing entries for demo purposes

// Guarantee at least 12 rentals, 12 luxury, and 12 recent listings for scrollable carousels
for (let i = 0; i < 36; i++) {
  const base = listings[i % listings.length];
  const listingType = i < 12 ? "rent" : i % 2 === 0 ? "sale" : "rent";
  let price = base.price;
  // Ensure some luxury rentals (rent >= $7,000)
  if (listingType === "rent") {
    if (i < 4)
      price = 8500 + i * 500; // 4 luxury rentals $8,500–$10,000
    else if (i < 12) price = 1500 + ((i * 500) % 5500);
    else if (i >= 12 && i < 16)
      price = 7500 + i * 400; // 4 more luxury rentals $7,500–$9,100
    else price = 2000 + ((i * 350) % 6000);
  } else {
    if (i >= 12 && i < 24) price = 1200000 + ((i * 10000) % 800000); // luxury
    if (i >= 24) price = 400000 + ((i * 5000) % 600000); // recent, mid-range
  }
  listings.push({
    ...base,
    id: (100 + i).toString(),
    title: base.title + ` (Demo ${i + 1})`,
    address: 1000 + i + " " + base.address,
    price,
    featured: i % 3 === 0,
    listingType: listingType as import("./types").ListingType,
    city: ["Washington", "Baltimore", "Alexandria", "Bethesda", "Silver Spring"][i % 5],
    brokerName: ["Sarah Mitchell", "James Carter", "Maria Lopez", "David Kim"][i % 4],
    brokerEmail: `demo${i}@realbroker.com`,
    brokerPhone: `(555) 555-01${(10 + i).toString().padStart(2, "0")}`,
    lastUpdated: new Date(Date.now() - i * 86400000).toISOString(),
    openHouse:
      i % 4 === 0 ? { date: "2026-05-0" + ((i % 9) + 1), startTime: "12:00 PM", endTime: "2:00 PM" } : undefined,
    priceReduced: i % 5 === 0,
    newConstruction: i % 6 === 0,
    amenities: base.amenities?.slice(0, (i % (base.amenities?.length || 3)) + 1),
    imageUrls: base.imageUrls?.map((url, idx) => url.replace("?w=1200", `?w=1200&sig=${i}-${idx}`)),
  });
}

// --- Data cleaning: ensure all listings have valid city, state, zip ---
function normalizeZip(zip: string): string {
  if (!zip) return "";
  const z = zip.trim();
  // Pad to 5 digits if needed
  return z.length === 5 ? z : z.padStart(5, "0");
}

function normalizeState(state: string): string {
  if (!state) return "";
  return state.trim().toUpperCase();
}

function normalizeCity(city: string): string {
  if (!city) return "";
  // Title case (e.g., "Washington", "Silver Spring")
  return city
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

listings = listings.map((l) => ({
  ...l,
  city: normalizeCity(l.city),
  state: normalizeState(l.state),
  zip: normalizeZip(l.zip),
}));

export default listings;
