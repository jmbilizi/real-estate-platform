import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Primary: warm coral/rose (modern, premium real-estate feel)
        brand: {
          DEFAULT: "#FF385C",
          50: "#FFF1F3",
          100: "#FFE4E8",
          200: "#FECDD3",
          500: "#FB5A75",
          600: "#FF385C",
          700: "#E11D48",
          900: "#881337",
        },
        // Secondary: refined sage for trust accents
        accent: {
          DEFAULT: "#0E7C66",
          500: "#14B8A6",
          600: "#0E7C66",
        },
        // Neutral ink / typography
        ink: {
          DEFAULT: "#111827",
          muted: "#4B5563",
          subtle: "#9CA3AF",
        },
        // Warm surfaces
        surface: {
          DEFAULT: "#FFFFFF",
          alt: "#FAFAF9",
          soft: "#F5F5F4",
          border: "#E7E5E4",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ['"Plus Jakarta Sans"', "Inter", "system-ui", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(17,24,39,0.04), 0 2px 8px rgba(17,24,39,0.06)",
        cardHover: "0 6px 16px rgba(17,24,39,0.10), 0 16px 40px rgba(17,24,39,0.12)",
        pop: "0 10px 32px rgba(17,24,39,0.14)",
      },
      borderRadius: {
        xl: "1rem",
        "2xl": "1.25rem",
        "3xl": "1.75rem",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        fadeUp: "fadeUp 0.4s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
