const sharp = require('sharp');
const { rgbDistance, toHex } = require('./utils');

function clampColor(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function quantizeChannel(value) {
  return Math.round(value / 8) * 8;
}

async function extractPaletteFromImageUrl(imageUrl, options = {}) {
  const colorCount = options.colorCount || 5;

  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Unable to fetch image: ${response.status} ${response.statusText}`);
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer());
  const { data, info } = await sharp(imageBuffer)
    .resize(96, 96, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (!info.width || !info.height) {
    return [];
  }

  const buckets = new Map();
  const step = Math.max(3, Math.floor(data.length / 20000));

  for (let index = 0; index < data.length; index += step) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];

    if (r === undefined || g === undefined || b === undefined) {
      continue;
    }

    const brightness = (r + g + b) / 3;
    if (brightness < 10 || brightness > 250) {
      continue;
    }

    const qr = quantizeChannel(r);
    const qg = quantizeChannel(g);
    const qb = quantizeChannel(b);
    const key = `${qr},${qg},${qb}`;
    const bucket = buckets.get(key) || { r: 0, g: 0, b: 0, count: 0 };

    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  const ranked = Array.from(buckets.values())
    .map((bucket) => ({
      r: clampColor(bucket.r / bucket.count),
      g: clampColor(bucket.g / bucket.count),
      b: clampColor(bucket.b / bucket.count),
      count: bucket.count,
    }))
    .sort((a, b) => b.count - a.count);

  const colors = [];
  const minDistance = 34;

  for (const color of ranked) {
    if (colors.some((existing) => rgbDistance(existing, color) < minDistance)) {
      continue;
    }

    colors.push(color);
    if (colors.length >= colorCount) {
      break;
    }
  }

  if (!colors.length) {
    return [];
  }

  const total = colors.reduce((sum, color) => sum + color.count, 0);

  return colors.map((color) => ({
    hex: `#${toHex(color.r, color.g, color.b)}`,
    rgb: [color.r, color.g, color.b],
    ratio: Number((color.count / total).toFixed(4)),
  }));
}

module.exports = {
  extractPaletteFromImageUrl,
};