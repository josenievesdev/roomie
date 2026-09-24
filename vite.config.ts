import { defineConfig } from "vite";

// El servidor de juego (server/, Socket.io) escucha en :3001. El navegador se
// conecta SIEMPRE a su propia origen (`io()` sin URL) y Vite hace de proxy:
// así funciona igual en `npm run dev`, en `vite --host` (red local) y detrás de
// cualquier hosting que reverse-proxie /socket.io.
const GAME_SERVER = process.env.GAME_SERVER ?? "http://localhost:3001";

const proxy = {
  "/socket.io": {
    target: GAME_SERVER,
    ws: true,
  },
};

export default defineConfig({
  server: { proxy },
  preview: { proxy },
});
