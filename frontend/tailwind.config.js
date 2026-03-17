/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'monospace'],
      },
      colors: {
        surface: { DEFAULT: '#161B22', raised: '#1C2129', hover: '#21262D' },
        border: { DEFAULT: '#30363D', light: '#21262D', focus: '#58A6FF' },
        accent: { DEFAULT: '#58A6FF', hover: '#79C0FF', muted: '#58A6FF20' },
      },
    },
  },
  plugins: [],
};
