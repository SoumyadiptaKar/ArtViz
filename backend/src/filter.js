const {
  cleanText,
  lowerText,
  parseYear,
  pickLocalizedText,
  localizedVariants,
  normalizeName,
  flattenLocalizedArray,
  unique,
  formatYears,
  pickPrimaryImage,
  textFieldsForSearch,
} = require('./utils');

const POSITIVE_TERMS = [
  'painting',
  'painted',
  'oil on canvas',
  'oil on board',
  'oil on panel',
  'oil on paper',
  'acrylic',
  'tempera',
  'gouache',
  'watercolor',
  'watercolour',
  'canvas',
  'panel',
  'maalaus',
  'maalattu',
];

const NEGATIVE_TERMS = [
  'sketch',
  'sketches',
  'drawing',
  'drawings',
  'pencil',
  'charcoal',
  'study drawing',
  'line drawing',
  'graphic arts',
  'woodblock print',
  'woodcut',
  'print',
  'poster',
  'photograph',
  'photo',
  'etching',
  'engraving',
  'lithograph',
  'screenprint',
  'intaglio',
  'book illustration',
  'painettu',
];

function normalizeArtwork(record, mediaBaseUrl) {
  const title = pickLocalizedText(record.title) || `Artwork ${record.objectId}`;
  const category = localizedVariants(record.category);
  const collection = localizedVariants(record.collection);
  const datePrefix = localizedVariants(record.datePrefix);
  const acquisitionMethod = localizedVariants(record.acquisitionMethod);
  const description = localizedVariants(record.description);
  const materials = flattenLocalizedArray(record.materials);
  const keywords = flattenLocalizedArray(record.keywords);
  const classifications = flattenLocalizedArray(record.classifications);
  const artistNames = unique((record.people || []).map(normalizeName));
  const artistPeople = (record.people || []).map((person) => ({
    id: person.id ?? null,
    name: normalizeName(person),
    firstName: cleanText(person.firstName),
    familyName: cleanText(person.familyName),
    role: pickLocalizedText(person.role),
    attribution: pickLocalizedText(person.attribution),
    birthYear: parseYear(person.birthYear),
    deathYear: parseYear(person.deathYear),
  }));
  const images = (record.multimedia || [])
    .map((item) => pickPrimaryImage([item], mediaBaseUrl))
    .filter(Boolean);
  const primaryImage = images[0] || null;
  const startYear = parseYear(record.yearFrom) ?? parseYear(record.acquisitionYear);
  const endYear = parseYear(record.yearTo) ?? parseYear(record.acquisitionYear);

  return {
    id: String(record.objectId),
    objectId: record.objectId,
    title,
    titleVariants: localizedVariants(record.title),
    categoryId: cleanText(record.category?.categoryId),
    category,
    collection,
    inventoryNumber: cleanText(record.inventoryNumber),
    owner: cleanText(record.owner),
    responsibleOrganisation: cleanText(record.responsibleOrganisation),
    museum: cleanText(record.responsibleOrganisation || record.owner),
    materials,
    keywords,
    classifications,
    artistNames,
    artists: artistPeople,
    description: pickLocalizedText(record.description),
    descriptionTexts: Object.values(description).filter(Boolean),
    acquisitionMethod,
    datePrefix,
    timeline: {
      dateFrom: cleanText(record.dateFrom),
      acquisitionDate: cleanText(record.acquisitionDate),
      acquisitionYear: parseYear(record.acquisitionYear),
      yearFrom: parseYear(record.yearFrom),
      yearTo: parseYear(record.yearTo),
      label: formatYears(startYear, endYear),
    },
    dimensions: Array.isArray(record.dimensions)
      ? record.dimensions.map((dimension) => ({
          measurements: Array.isArray(dimension.measurements)
            ? dimension.measurements.slice()
            : [],
          unit: cleanText(dimension.unit),
          measureType: pickLocalizedText(dimension.measureType),
          sortLnu: dimension.sortLnu ?? null,
        }))
      : [],
    images,
    image: primaryImage,
    exhibitions: Array.isArray(record.exhibitions)
      ? record.exhibitions.map((exhibition) => ({
          id: exhibition.id ?? null,
          title: cleanText(exhibition.title),
          startDate: cleanText(exhibition.startDate),
          endDate: cleanText(exhibition.endDate),
          location: cleanText(exhibition.location),
        }))
      : [],
    people: artistPeople,
    children: Array.isArray(record.children) ? record.children.slice() : [],
    parents: Array.isArray(record.parents) ? record.parents.slice() : [],
    source: {
      objectId: record.objectId,
      collection: collection.en || collection.fi || collection.sv || '',
      responsibleOrganisation: cleanText(record.responsibleOrganisation),
    },
    raw: record,
    paintingSignalText: [
      title,
      category.en,
      category.fi,
      category.sv,
      ...materials,
      ...classifications,
      ...keywords,
    ]
      .map(lowerText)
      .filter(Boolean)
      .join(' | '),
    searchText: textFieldsForSearch({
      title,
      category,
      collection,
      materials,
      classifications,
      keywords,
      artistNames,
      descriptionTexts: Object.values(description).filter(Boolean),
      inventoryNumber: cleanText(record.inventoryNumber),
      owner: cleanText(record.owner),
    }),
    palette: Array.isArray(record.palette) ? record.palette : [],
    paletteStatus: Array.isArray(record.palette) && record.palette.length > 0 ? 'ready' : 'not-generated',
  };
}

function hasPaintingSignals(artwork) {
  const text = artwork.paintingSignalText;

  const hasPositive = POSITIVE_TERMS.some((term) => text.includes(term));
  const hasNegative = NEGATIVE_TERMS.some((term) => text.includes(term));

  return hasPositive && !hasNegative;
}

function filterPaintings(artworks) {
  return artworks.filter((artwork) => artwork.image && hasPaintingSignals(artwork));
}

function applyArtworksQuery(artworks, query) {
  const artist = cleanText(query.artist).toLowerCase();
  const collection = cleanText(query.collection).toLowerCase();
  const material = cleanText(query.material).toLowerCase();
  const classification = cleanText(query.classification).toLowerCase();
  const q = cleanText(query.q || query.search || query.term).toLowerCase();
  const yearFrom = query.yearFrom !== undefined ? Number(query.yearFrom) : null;
  const yearTo = query.yearTo !== undefined ? Number(query.yearTo) : null;

  return artworks.filter((artwork) => {
    if (artist && !artwork.artistNames.some((name) => name.toLowerCase().includes(artist))) {
      return false;
    }

    if (
      collection &&
      !artwork.collection.en.toLowerCase().includes(collection) &&
      !artwork.collection.fi.toLowerCase().includes(collection) &&
      !artwork.collection.sv.toLowerCase().includes(collection)
    ) {
      return false;
    }

    if (material && !artwork.materials.some((item) => item.toLowerCase().includes(material))) {
      return false;
    }

    if (
      classification &&
      !artwork.classifications.some((item) => item.toLowerCase().includes(classification))
    ) {
      return false;
    }

    if (q && !artwork.searchText.includes(q)) {
      return false;
    }

    if (Number.isFinite(yearFrom)) {
      const recordYear = artwork.timeline.yearFrom ?? artwork.timeline.yearTo ?? artwork.timeline.acquisitionYear;
      if (recordYear === null || recordYear < yearFrom) {
        return false;
      }
    }

    if (Number.isFinite(yearTo)) {
      const recordYear = artwork.timeline.yearTo ?? artwork.timeline.yearFrom ?? artwork.timeline.acquisitionYear;
      if (recordYear === null || recordYear > yearTo) {
        return false;
      }
    }

    return true;
  });
}

function computeFacets(artworks) {
  const artistCounts = new Map();
  const collectionCounts = new Map();
  const materialCounts = new Map();
  const classificationCounts = new Map();
  const years = [];

  for (const artwork of artworks) {
    for (const artist of artwork.artistNames) {
      artistCounts.set(artist, (artistCounts.get(artist) || 0) + 1);
    }

    const collectionName = artwork.collection.en || artwork.collection.fi || artwork.collection.sv;
    if (collectionName) {
      collectionCounts.set(collectionName, (collectionCounts.get(collectionName) || 0) + 1);
    }

    for (const material of artwork.materials) {
      materialCounts.set(material, (materialCounts.get(material) || 0) + 1);
    }

    for (const classification of artwork.classifications) {
      classificationCounts.set(classification, (classificationCounts.get(classification) || 0) + 1);
    }

    const year = artwork.timeline.yearFrom ?? artwork.timeline.yearTo ?? artwork.timeline.acquisitionYear;
    if (Number.isFinite(year)) {
      years.push(year);
    }
  }

  const toList = (map) =>
    Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  return {
    artists: toList(artistCounts),
    collections: toList(collectionCounts),
    materials: toList(materialCounts),
    classifications: toList(classificationCounts),
    yearRange: years.length
      ? {
          min: Math.min(...years),
          max: Math.max(...years),
        }
      : { min: null, max: null },
  };
}

module.exports = {
  normalizeArtwork,
  filterPaintings,
  applyArtworksQuery,
  computeFacets,
};