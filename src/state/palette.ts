// Paleta del avatar. Módulo PURO (sin Phaser): usable por el juego, el
// guardado y (en el futuro) el servidor.
export type Palette = { shirt: number; hair: number };

export type Swatch = { label: string; value: number };

export const DEFAULT_PALETTE: Palette = {
  shirt: 0x6c5ce7,
  hair: 0x4a3226,
};

export const SHIRT_COLORS: Swatch[] = [
  { label: "morado", value: 0x6c5ce7 },
  { label: "rojo", value: 0xe74c3c },
  { label: "verde", value: 0x00b894 },
  { label: "naranja", value: 0xf39c12 },
  { label: "azul", value: 0x0984e3 },
  { label: "rosa", value: 0xfd79a8 },
];

export const HAIR_COLORS: Swatch[] = [
  { label: "castaño", value: 0x4a3226 },
  { label: "negro", value: 0x1a1a24 },
  { label: "rubio", value: 0xfdcb6e },
  { label: "pelirrojo", value: 0xe17055 },
  { label: "blanco", value: 0xf5f5f5 },
  { label: "turquesa", value: 0x00cec9 },
];

/** Recupera la paleta del guardado, con valores por defecto si faltan */
export function paletteFrom(
  save: { shirt?: number; hair?: number } | null | undefined,
): Palette {
  return {
    shirt:
      save && typeof save.shirt === "number" && Number.isFinite(save.shirt)
        ? save.shirt
        : DEFAULT_PALETTE.shirt,
    hair:
      save && typeof save.hair === "number" && Number.isFinite(save.hair)
        ? save.hair
        : DEFAULT_PALETTE.hair,
  };
}
