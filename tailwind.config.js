/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: {
          950: "#07111f",
          900: "#0b1728",
          800: "#11243d",
          700: "#163253"
        },
        verified: {
          50: "#ecfdf5",
          100: "#d1fae5",
          500: "#10b981",
          600: "#059669",
          700: "#047857"
        }
      },
      boxShadow: {
        soft: "0 20px 60px -24px rgba(7, 17, 31, 0.28)",
        card: "0 14px 36px -22px rgba(7, 17, 31, 0.32)"
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      }
    },
  },
  plugins: [],
};
