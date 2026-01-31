/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './index.html',
    './src/**/*.{js,jsx}'
  ],
  theme: {
    extend: {
      boxShadow: {
        glass: '0 20px 45px rgba(15, 23, 42, 0.35)'
      }
    }
  },
  plugins: []
};
