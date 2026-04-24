const sharp = require('sharp');
const { rgbDistance, toHex } = require('./utils');

function clampColor(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function kmeansClustering(points, k, maxIterations = 20) {
  if (points.length === 0) return [];
  if (k >= points.length) return points.map(p => [...p]);

  // Initialize centroids by selecting k random points
  const centroids = [];
  const used = new Set();
  
  for (let i = 0; i < k && centroids.length < points.length; i++) {
    let idx;
    do {
      idx = Math.floor(Math.random() * points.length);
    } while (used.has(idx));
    used.add(idx);
    centroids.push([...points[idx]]);
  }

  let assignments = new Array(points.length);

  for (let iter = 0; iter < maxIterations; iter++) {
    // Assign each point to nearest centroid
    for (let i = 0; i < points.length; i++) {
      let minDist = Infinity;
      let bestCentroid = 0;
      
      for (let j = 0; j < centroids.length; j++) {
        const dist = 
          Math.pow(points[i][0] - centroids[j][0], 2) +
          Math.pow(points[i][1] - centroids[j][1], 2) +
          Math.pow(points[i][2] - centroids[j][2], 2);
        
        if (dist < minDist) {
          minDist = dist;
          bestCentroid = j;
        }
      }
      assignments[i] = bestCentroid;
    }

    // Update centroids
    const newCentroids = [];
    for (let j = 0; j < centroids.length; j++) {
      const cluster = [];
      for (let i = 0; i < points.length; i++) {
        if (assignments[i] === j) {
          cluster.push(points[i]);
        }
      }
      
      if (cluster.length > 0) {
        const means = [
          cluster.reduce((sum, p) => sum + p[0], 0) / cluster.length,
          cluster.reduce((sum, p) => sum + p[1], 0) / cluster.length,
          cluster.reduce((sum, p) => sum + p[2], 0) / cluster.length,
        ];
        newCentroids[j] = means;
      } else {
        newCentroids[j] = centroids[j];
      }
    }
    centroids.length = 0;
    centroids.push(...newCentroids);
  }

  return centroids.map(c => [clampColor(c[0]), clampColor(c[1]), clampColor(c[2])]);
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

  const points = [];
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

    points.push([r, g, b]);
  }

  if (!points.length) {
    return [];
  }

  const clusters = kmeansClustering(points, Math.min(colorCount, points.length));

  // Count points per cluster for weighting
  const clusterCounts = new Array(clusters.length).fill(0);
  for (let i = 0; i < points.length; i++) {
    let minDist = Infinity;
    let bestCluster = 0;
    
    for (let j = 0; j < clusters.length; j++) {
      const dist = 
        Math.pow(points[i][0] - clusters[j][0], 2) +
        Math.pow(points[i][1] - clusters[j][1], 2) +
        Math.pow(points[i][2] - clusters[j][2], 2);
      
      if (dist < minDist) {
        minDist = dist;
        bestCluster = j;
      }
    }
    clusterCounts[bestCluster] += 1;
  }

  const total = clusterCounts.reduce((a, b) => a + b, 0);

  return clusters
    .map((cluster, i) => ({
      hex: `#${toHex(cluster[0], cluster[1], cluster[2])}`,
      rgb: cluster,
      ratio: Number((clusterCounts[i] / total).toFixed(4)),
    }))
    .sort((a, b) => b.ratio - a.ratio);
}

module.exports = {
  extractPaletteFromImageUrl,
  extractPaletteFromBuffer,
};

async function extractPaletteFromBuffer(buffer, options = {}) {
  const colorCount = options.colorCount || 5;

  const { data, info } = await sharp(buffer)
    .resize(96, 96, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (!info.width || !info.height) {
    return [];
  }

  const points = [];
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

    points.push([r, g, b]);
  }

  if (!points.length) {
    return [];
  }

  const clusters = kmeansClustering(points, Math.min(colorCount, points.length));

  // Count points per cluster for weighting
  const clusterCounts = new Array(clusters.length).fill(0);
  for (let i = 0; i < points.length; i++) {
    let minDist = Infinity;
    let bestCluster = 0;
    
    for (let j = 0; j < clusters.length; j++) {
      const dist = 
        Math.pow(points[i][0] - clusters[j][0], 2) +
        Math.pow(points[i][1] - clusters[j][1], 2) +
        Math.pow(points[i][2] - clusters[j][2], 2);
      
      if (dist < minDist) {
        minDist = dist;
        bestCluster = j;
      }
    }
    clusterCounts[bestCluster] += 1;
  }

  const total = clusterCounts.reduce((a, b) => a + b, 0);

  return clusters
    .map((cluster, i) => ({
      hex: `#${toHex(cluster[0], cluster[1], cluster[2])}`,
      rgb: cluster,
      ratio: Number((clusterCounts[i] / total).toFixed(4)),
    }))
    .sort((a, b) => b.ratio - a.ratio);
}