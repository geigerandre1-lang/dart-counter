/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./client/index.html", "./client/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#05070d",
          900: "#080c16",
          800: "#0e1524",
          700: "#162033",
          600: "#1e2c44",
        },
        amber: {
          glow: "#ffb020",
          dim: "#c4841a",
        },
        crimson: {
          DEFAULT: "#ff3355",
          dim: "#a81d38",
        },
      },
      fontFamily: {
        display: [
          "Impact",
          "Haettenschweiler",
          "Arial Narrow",
          "system-ui",
          "sans-serif",
        ],
        sans: [
          "Segoe UI",
          "system-ui",
          "Roboto",
          "Helvetica Neue",
          "sans-serif",
        ],
      },
      boxShadow: {
        glow: "0 0 40px rgba(255, 176, 32, 0.25)",
        pad: "inset 0 1px 0 rgba(255,255,255,0.08), 0 8px 24px rgba(0,0,0,0.45)",
      },
      minHeight: {
        touch: "3.5rem",
        kiosk: "4.75rem",
      },
    },
  },
  plugins: [],
};
