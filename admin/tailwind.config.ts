import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        rose:      '#C8788A',
        'rose-dark': '#8C4A58',
        cream:     '#FAF7F4',
        'warm-dark': '#3D2E2E',
      },
    },
  },
  plugins: [],
}

export default config
