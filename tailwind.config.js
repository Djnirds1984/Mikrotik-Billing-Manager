/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './components/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
    './hooks/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        // AirCoins dark palette
        surface: {
          DEFAULT: '#0F121D',
          card: '#151A28',
          elevated: '#1C2538',
          input: '#1C2234',
          sidebar: '#101422',
          pill: '#1C2538',
        },
        accent: {
          DEFAULT: '#00E5FF',
          bright: '#00C2FF',
          glow: 'rgba(0, 229, 255, 0.15)',
        },
        txt: {
          primary: '#FFFFFF',
          muted: '#8A94A6',
          dim: '#5A6478',
        },
        border: {
          DEFAULT: '#1E2538',
          light: '#2A3348',
        },
      },
      borderRadius: {
        card: '10px',
      },
      boxShadow: {
        card: '0 2px 12px rgba(0,0,0,0.35)',
        glow: '0 0 20px rgba(0, 229, 255, 0.15)',
      },
    },
  },
  plugins: [],
};
