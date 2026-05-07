import { Amenity } from "@/lib/types";

const ICONS: Record<Amenity, string> = {
  Pool: "🏊",
  Garage: "🚗",
  Gym: "🏋️",
  Elevator: "🛗",
  Balcony: "🌅",
  Fireplace: "🔥",
  "Washer/Dryer": "👕",
  "Pet Friendly": "🐾",
  Waterfront: "🌊",
  Office: "💼",
  Rooftop: "🏙️",
  Garden: "🌿",
  "Smart Home": "📱",
  Solar: "☀️",
  "EV Charging": "⚡",
};

export default function AmenityChips({ amenities }: { amenities: Amenity[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {amenities.map((a) => (
        <span
          key={a}
          className="inline-flex items-center gap-1.5 rounded-full border border-surface-border bg-surface-alt px-3 py-1.5 text-sm"
        >
          <span>{ICONS[a] ?? "✓"}</span>
          {a}
        </span>
      ))}
    </div>
  );
}
