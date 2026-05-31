import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['REACT_APP_', 'VITE_', '']);

  return {
    plugins: [react()],

    // Inject process.env.REACT_APP_* as compile-time constants
    define: {
      'process.env.REACT_APP_ALCHEMY_KEY': JSON.stringify(env.REACT_APP_ALCHEMY_KEY ?? ''),
      'process.env.REACT_APP_INFURA_KEY':  JSON.stringify(env.REACT_APP_INFURA_KEY  ?? ''),
    },

    optimizeDeps: {
      esbuildOptions: {
        loader: { '.js': 'jsx' },
      },
    },

    server: {
      port: 3000,
      open: false,
    },
  };
});
