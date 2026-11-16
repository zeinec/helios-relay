// HELIOS RELAY palette — warm dusk desert: dark canvas, sandy mid-tones,
// rust accents, vanguard red vs sentinel teal for the two teams.
export const PALETTE = {
  canvas: '#171310',
  surface: '#241c16',
  sand: '#c8a06a',
  rust: '#b4552d',
  ink: '#f2e8d8',
  muted: '#9a8a76',
  vanguard: '#e2543e',
  sentinel: '#3fa796',
};

export function shade(name) {
  if (!(name in PALETTE)) throw new Error(`unknown palette colour: ${name}`);
  return PALETTE[name];
}
