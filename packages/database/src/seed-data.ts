/**
 * Datos de DEMOSTRACIÓN. Las coordenadas son aproximadas y NO están verificadas
 * (verified_at = null). No sustituyen a un proveedor de datos de lugares.
 */
export const INTERESTS = [
  { slug: "cultura", labelEs: "Cultura" },
  { slug: "historia", labelEs: "Historia" },
  { slug: "naturaleza", labelEs: "Naturaleza" },
  { slug: "gastronomia", labelEs: "Gastronomía" },
  { slug: "aventura", labelEs: "Aventura" },
  { slug: "fotografia", labelEs: "Fotografía" },
  { slug: "mercados", labelEs: "Mercados" },
  { slug: "museos", labelEs: "Museos" },
  { slug: "arquitectura", labelEs: "Arquitectura" },
  { slug: "fauna", labelEs: "Fauna" },
  { slug: "relax", labelEs: "Relax" },
  { slug: "vida-nocturna", labelEs: "Vida nocturna" },
] as const;

export interface SeedPlace {
  key: string;
  name: string;
  description: string;
  lng: number;
  lat: number;
  countryCode: string;
  region: string;
  locality: string;
  timezone: string;
  interests: string[];
  minutes: number;
}

const IQ = { countryCode: "PE", region: "Loreto", locality: "Iquitos", timezone: "America/Lima" };
const CU = { countryCode: "PE", region: "Cusco", locality: "Cusco", timezone: "America/Lima" };
const LX = { countryCode: "PT", region: "Lisboa", locality: "Lisboa", timezone: "Europe/Lisbon" };

export const PLACES: SeedPlace[] = [
  { key: "iq-plaza-armas", name: "Plaza de Armas de Iquitos", description: "Plaza central de la ciudad, punto de partida habitual de los recorridos.", lng: -73.2538, lat: -3.7491, interests: ["historia", "arquitectura", "cultura"], minutes: 30, ...IQ },
  { key: "iq-casa-fierro", name: "Casa de Fierro", description: "Edificio de estructura metálica en el centro histórico.", lng: -73.2533, lat: -3.7487, interests: ["arquitectura", "historia", "fotografia"], minutes: 25, ...IQ },
  { key: "iq-catedral", name: "Catedral de Iquitos", description: "Iglesia matriz frente a la Plaza de Armas.", lng: -73.254, lat: -3.7497, interests: ["arquitectura", "historia"], minutes: 20, ...IQ },
  { key: "iq-malecon", name: "Malecón Tarapacá", description: "Paseo a orillas del río Itaya.", lng: -73.2493, lat: -3.744, interests: ["relax", "fotografia"], minutes: 45, ...IQ },
  { key: "iq-museo-amazonico", name: "Museo Amazónico", description: "Museo sobre la cultura y la historia de la Amazonía.", lng: -73.2496, lat: -3.7446, interests: ["museos", "cultura", "historia"], minutes: 60, ...IQ },
  { key: "iq-belen", name: "Mercado de Belén", description: "Mercado popular con productos amazónicos.", lng: -73.2475, lat: -3.766, interests: ["mercados", "gastronomia", "cultura"], minutes: 90, ...IQ },
  { key: "iq-rescate-amazonico", name: "Centro de Rescate Amazónico", description: "Centro de rescate de fauna en la carretera Iquitos–Nauta.", lng: -73.279, lat: -3.808, interests: ["fauna", "naturaleza"], minutes: 90, ...IQ },
  { key: "iq-quistococha", name: "Laguna de Quistococha", description: "Laguna y complejo turístico al sur de la ciudad.", lng: -73.2137, lat: -3.8313, interests: ["naturaleza", "relax", "fauna"], minutes: 150, ...IQ },

  { key: "cu-plaza-armas", name: "Plaza de Armas del Cusco", description: "Plaza principal del centro histórico.", lng: -71.9786, lat: -13.5167, interests: ["historia", "arquitectura", "cultura"], minutes: 40, ...CU },
  { key: "cu-catedral", name: "Catedral del Cusco", description: "Catedral en la Plaza de Armas.", lng: -71.9789, lat: -13.517, interests: ["arquitectura", "historia"], minutes: 45, ...CU },
  { key: "cu-qorikancha", name: "Qorikancha", description: "Sitio inca bajo el convento de Santo Domingo.", lng: -71.9753, lat: -13.5192, interests: ["historia", "museos", "arquitectura"], minutes: 60, ...CU },
  { key: "cu-san-pedro", name: "Mercado de San Pedro", description: "Mercado central de la ciudad.", lng: -71.9842, lat: -13.5217, interests: ["mercados", "gastronomia"], minutes: 60, ...CU },
  { key: "cu-san-blas", name: "Barrio de San Blas", description: "Barrio de calles empinadas con talleres artesanales.", lng: -71.9741, lat: -13.5148, interests: ["cultura", "fotografia"], minutes: 75, ...CU },
  { key: "cu-sacsayhuaman", name: "Sacsayhuamán", description: "Complejo arqueológico sobre la ciudad.", lng: -71.9818, lat: -13.5086, interests: ["historia", "aventura", "fotografia"], minutes: 120, ...CU },

  { key: "lx-praca-comercio", name: "Praça do Comércio", description: "Plaza abierta al río Tajo.", lng: -9.1364, lat: 38.7076, interests: ["arquitectura", "historia", "fotografia"], minutes: 30, ...LX },
  { key: "lx-castelo", name: "Castelo de São Jorge", description: "Castillo sobre la colina con vistas a la ciudad.", lng: -9.1335, lat: 38.7139, interests: ["historia", "fotografia"], minutes: 90, ...LX },
  { key: "lx-miradouro-monte", name: "Miradouro da Senhora do Monte", description: "Mirador en una de las colinas de Lisboa.", lng: -9.1326, lat: 38.72, interests: ["fotografia", "relax"], minutes: 30, ...LX },
  { key: "lx-time-out", name: "Mercado da Ribeira", description: "Mercado y espacio gastronómico.", lng: -9.1455, lat: 38.7068, interests: ["gastronomia", "mercados"], minutes: 60, ...LX },
  { key: "lx-lx-factory", name: "LX Factory", description: "Antiguo complejo industrial reconvertido en espacio creativo.", lng: -9.1779, lat: 38.7036, interests: ["cultura", "arquitectura"], minutes: 75, ...LX },
  { key: "lx-jeronimos", name: "Mosteiro dos Jerónimos", description: "Monasterio en el barrio de Belém.", lng: -9.2068, lat: 38.6979, interests: ["arquitectura", "historia"], minutes: 75, ...LX },
  { key: "lx-torre-belem", name: "Torre de Belém", description: "Torre fortificada junto al río Tajo.", lng: -9.216, lat: 38.6916, interests: ["historia", "fotografia"], minutes: 45, ...LX },
];
