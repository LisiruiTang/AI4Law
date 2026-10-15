import type {Config} from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        law: {
          blue: "#24588d",
          dark: "#365072",
          bright: "#00adef",
          light: "#a5d3ed",
          gold: "#ffb837",
        },
      },
    },
  },
  plugins: [],
};

export default config;
