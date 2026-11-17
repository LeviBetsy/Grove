// A little hooded forest wanderer, drawn pixel by pixel (16 × 20, facing right).
// Edit the maps below to redesign the character.

const PALETTE = {
  o: '#1a1c2c', // outline
  H: '#8be08a', // hood highlight
  h: '#3f9b55', // hood
  d: '#2c7442', // hood shade
  s: '#ffd9b3', // skin
  e: '#1a1c2c', // eye
  p: '#f59c9c', // blush
  C: '#7a2638', // cape shade
  c: '#c23f55', // cape
  t: '#8b5a3c', // tunic
  T: '#b07a4f', // tunic light
  l: '#3b2a20', // belt
  y: '#f5d547', // buckle
  b: '#5a3d2b', // boots
  g: '#fff3a8', // lantern glow
  G: '#f5b83d', // lantern frame
};

const HEAD = [
  '.....oooooo.....',
  '....oHHHHhhoo...',
  '...oHHhhhhhhhoo.',
  '..oHhhhhhhhhhhho',
  '..ohhhhhhoooooho',
  '.ohhhhhhosssssso',
  '.odhhhhhosssesso',
  '.odhhhhhosspssso',
  '..odhhhhhosssso.',
  '..oddhhhhhoooo..',
];

const BODY = [
  '..oCcotttttto...',
  '..oCcottTTttso..',
  '..oCcollylllo...',
  '..oCcottttto....',
  '...oCottttto....',
  '....oooooooo....',
];

const LEGS = {
  idle: [
    '.....obo.obo....',
    '.....obo.obo....',
    '.....obbo.obbo..',
    '.....oooo.oooo..',
  ],
  stride: [
    '....obo..obo....',
    '...obo....obo...',
    '..obbo....obbo..',
    '..oooo....oooo..',
  ],
  pass: [
    '......obo.......',
    '......obo.......',
    '......obbo......',
    '......oooo......',
  ],
};

export const SPRITE_W = 16;
export const SPRITE_H = 21; // one spare row for the bob

// pose: 'idle' | 'stride' | 'pass' | 'jump'
export function drawHero(ctx, scale, { pose = 'idle', blink = false, bob = 0, facing = 1, flutter = false } = {}) {
  const W = SPRITE_W * scale;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.save();
  if (facing < 0) { ctx.translate(W, 0); ctx.scale(-1, 1); }

  const px = (x, y, ch) => {
    const color = PALETTE[ch];
    if (!color) return;
    ctx.fillStyle = color;
    ctx.fillRect(x * scale, y * scale, scale, scale);
  };

  const legs = pose === 'jump' ? LEGS.stride : (LEGS[pose] || LEGS.idle);
  const top = 1 + bob; // body offset (bob of -1 lifts the character)

  HEAD.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (blink && ch === 'e') ch = 'o';
      px(x, y + top, ch);
    });
  });
  BODY.forEach((row, y) => [...row].forEach((ch, x) => px(x, y + top + HEAD.length, ch)));
  legs.forEach((row, y) => [...row].forEach((ch, x) => px(x, y + 1 + HEAD.length + BODY.length, ch)));

  // cape flaps behind while walking
  if (flutter) {
    const by = top + HEAD.length;
    px(1, by + 1, 'o'); px(1, by + 2, 'c'); px(0, by + 3, 'o'); px(1, by + 3, 'C');
  }

  // tiny lantern in the front hand
  const hy = top + HEAD.length + 2;
  px(13, hy, 'o'); px(13, hy + 1, 'G'); px(14, hy + 1, 'o');
  px(12, hy + 2, 'o'); px(13, hy + 2, 'g'); px(14, hy + 2, 'o');
  px(13, hy + 3, 'G');

  ctx.restore();
}
