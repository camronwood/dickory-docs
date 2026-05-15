/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        slack: {
          bg: "#1a1d21",
          bgHover: "#222529",
          sidebar: "#3f0e40",
          text: "#d1d2d3",
          textMuted: "#9ca3af",
          accent: "#1164a3",
          accentHover: "#0e4c7a",
          success: "#148567",
          border: "#545454",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          "Roboto",
          '"Helvetica Neue"',
          "Arial",
          "sans-serif",
        ],
        mono: [
          '"SF Mono"',
          "Monaco",
          '"Cascadia Code"',
          '"Roboto Mono"',
          "Consolas",
          "monospace",
        ],
      },
    },
  },
  plugins: [],
};
