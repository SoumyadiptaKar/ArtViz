function cleanText(value) {
  if (!value) {
    return '';
  }

  return String(value)
    .replace(/\s+/g, ' ')
    .trim();
}

function lowerText(value) {
  return cleanText(value).toLowerCase();
}

function parseYear(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickLocalizedText(value, preferredLanguage = 'en') {
  if (!value) {
    return '';
  }

  if (typeof value === 'string') {
    return cleanText(value);
  }

  if (typeof value !== 'object') {
    return '';
  }

  const preferred = cleanText(value[preferredLanguage]);
  if (preferred) {
    return preferred;
  }

  return cleanText(value.en || value.fi || value.sv || '');
}

function localizedVariants(value) {
  if (!value || typeof value !== 'object') {
    return { fi: '', sv: '', en: '' };
  }

  return {
    fi: cleanText(value.fi),
    sv: cleanText(value.sv),
    en: cleanText(value.en),
  };
}

function normalizeName(person) {
  const firstName = cleanText(person?.firstName);
  const familyName = cleanText(person?.familyName);
  const parts = [firstName, familyName].filter(Boolean);

  if (parts.length) {
    return parts.join(' ');
  }

  return cleanText(person?.sortName || person?.name || person?.displayName);
}

function flattenLocalizedArray(values, preferredLanguage = 'en') {
  if (!Array.isArray(values)) {
    return [];
  }

  return values
    .map((value) => pickLocalizedText(value, preferredLanguage))
    .filter(Boolean);
}

function unique(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function toHex(r, g, b) {
  return [r, g, b]
    .map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

function rgbDistance(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function formatYears(startYear, endYear) {
  if (startYear && endYear && startYear !== endYear) {
    return `${startYear}–${endYear}`;
  }

  if (startYear) {
    return String(startYear);
  }

  if (endYear) {
    return String(endYear);
  }

  return '';
}

function normalizeMediaUrl(url, mediaBaseUrl) {
  if (!url) {
    return '';
  }

  if (/^https?:\/\//i.test(url)) {
    return url;
  }

  if (!mediaBaseUrl) {
    return url;
  }

  return `${mediaBaseUrl.replace(/\/$/, '')}/${String(url).replace(/^\//, '')}`;
}

function chooseLargestWidthLink(linkMap) {
  if (!linkMap || typeof linkMap !== 'object') {
    return '';
  }

  const keys = Object.keys(linkMap);
  if (!keys.length) {
    return '';
  }

  const widthKey = keys
    .map((key) => ({ key, width: Number(key) }))
    .filter((entry) => Number.isFinite(entry.width))
    .sort((a, b) => b.width - a.width)[0]?.key;

  if (widthKey) {
    return cleanText(linkMap[widthKey]);
  }

  return cleanText(linkMap[keys[0]]);
}

function resolveMediaUrl(multimediaItem, mediaBaseUrl) {
  if (!multimediaItem || typeof multimediaItem !== 'object') {
    return '';
  }

  const candidates = [
    multimediaItem.url,
    multimediaItem.href,
    multimediaItem.address?.url,
    chooseLargestWidthLink(multimediaItem.webp),
    chooseLargestWidthLink(multimediaItem.jpg),
    chooseLargestWidthLink(multimediaItem.png),
  ];

  const selected = candidates.map((value) => cleanText(value)).find(Boolean);
  return normalizeMediaUrl(selected, mediaBaseUrl);
}

function pickPrimaryImage(multimedia, mediaBaseUrl) {
  if (!Array.isArray(multimedia)) {
    return null;
  }

  const candidates = multimedia
    .map((item) => {
      const url = resolveMediaUrl(item, mediaBaseUrl);
      if (!url) {
        return null;
      }

      return {
        id: item.id ?? null,
        url,
        width: item.width ?? item.image_width ?? null,
        height: item.height ?? item.image_height ?? null,
        license: cleanText(item.license),
        photographer: cleanText(item.photographer_name),
        filename: cleanText(item.filename),
        isRiaDisplayImage: Boolean(item.isRiaDisplayImage),
      };
    })
    .filter(Boolean);

  if (!candidates.length) {
    return null;
  }

  const preferred = candidates.find((candidate) => candidate.isRiaDisplayImage);
  return preferred || candidates[0];
}

function textFieldsForSearch(record) {
  return [
    record.title,
    record.category?.en,
    record.category?.fi,
    record.category?.sv,
    record.collection?.en,
    record.collection?.fi,
    record.collection?.sv,
    ...record.materials,
    ...record.classifications,
    ...record.keywords,
    ...record.artistNames,
    ...record.descriptionTexts,
    record.inventoryNumber,
    record.owner,
  ]
    .map(lowerText)
    .filter(Boolean)
    .join(' | ');
}

module.exports = {
  cleanText,
  lowerText,
  parseYear,
  pickLocalizedText,
  localizedVariants,
  normalizeName,
  flattenLocalizedArray,
  unique,
  toHex,
  rgbDistance,
  formatYears,
  normalizeMediaUrl,
  resolveMediaUrl,
  pickPrimaryImage,
  textFieldsForSearch,
};