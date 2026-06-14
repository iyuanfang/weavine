import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { accent: { DEFAULT: '#2563eb' } },
    },
  },
  plugins: [],
};

export default config;
