import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync, writeFileSync } from 'node:fs';

export default defineConfig({
  plugins: [{
    name: 'crazygames-entry',
    writeBundle(options) {
      const root = options.dir || 'dist';
      const html = readFileSync(resolve(root, 'index.html'), 'utf8')
        .replace(/<script\b[^>]*src="https:\/\/pagead2\.googlesyndication\.com[^>]*><\/script>/g, '')
        .replace(/<iframe\b[^>]*data-aa="2458071"[^>]*><\/iframe>/g, '')
        .replace(/<link\b[^>]*href="https:\/\/acceptable\.a-ads\.com"[^>]*>/g, '')
        .replace('<body class="has-top-ad">', '<body class="crazygames-platform">')
        .replace('</head>', '<style>#frame,#nav-logout-btn,#profile-logout-btn{display:none!important}</style></head>');
      writeFileSync(resolve(root, 'crazygames.html'), html);
    },
  }],
  base: './',
  server: {
    host: true,
    port: 5173
  },
  build: {
    sourcemap: false, // Never publish source maps with production assets.
    rollupOptions: {
      input: {
        main:     resolve(__dirname, 'index.html'),
        preview:  resolve(__dirname, 'preview.html'),
        login:    resolve(__dirname, 'login.html'),
        register: resolve(__dirname, 'register.html'),
        earnings: resolve(__dirname, 'earnings.html'),
        economyAdmin: resolve(__dirname, 'economy-admin.html'),
        privacy:  resolve(__dirname, 'privacy.html'),
        terms:    resolve(__dirname, 'terms.html'),
      },
    },
  },
});
