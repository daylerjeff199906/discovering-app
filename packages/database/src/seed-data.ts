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

export const PLACES: SeedPlace[] = [
  { key: "iq-plaza-armas", name: "Plaza de Armas de Iquitos", description: "Plaza central de la ciudad, punto de partida habitual de los recorridos.", lng: -73.2538, lat: -3.7491, interests: ["historia", "arquitectura", "cultura"], minutes: 30, ...IQ },
  { key: "iq-casa-fierro", name: "Casa de Fierro", description: "Edificio de estructura metálica en el centro histórico.", lng: -73.2533, lat: -3.7487, interests: ["arquitectura", "historia", "fotografia"], minutes: 25, ...IQ },
  { key: "iq-catedral", name: "Catedral de Iquitos", description: "Iglesia matriz frente a la Plaza de Armas.", lng: -73.254, lat: -3.7497, interests: ["arquitectura", "historia"], minutes: 20, ...IQ },
  { key: "iq-malecon", name: "Malecón Tarapacá", description: "Paseo a orillas del río Itaya.", lng: -73.2493, lat: -3.744, interests: ["relax", "fotografia"], minutes: 45, ...IQ },
  { key: "iq-museo-amazonico", name: "Museo Amazónico", description: "Museo sobre la cultura y la historia de la Amazonía.", lng: -73.2496, lat: -3.7446, interests: ["museos", "cultura", "historia"], minutes: 60, ...IQ },
  { key: "iq-belen", name: "Mercado de Belén", description: "Mercado popular con productos amazónicos.", lng: -73.2475, lat: -3.766, interests: ["mercados", "gastronomia", "cultura"], minutes: 90, ...IQ },
  { key: "iq-rescate-amazonico", name: "Centro de Rescate Amazónico", description: "Centro de rescate de fauna en la carretera Iquitos–Nauta.", lng: -73.279, lat: -3.808, interests: ["fauna", "naturaleza"], minutes: 90, ...IQ },
  { key: "iq-quistococha", name: "Laguna de Quistococha", description: "Laguna y complejo turístico al sur de la ciudad.", lng: -73.2137, lat: -3.8313, interests: ["naturaleza", "relax", "fauna"], minutes: 150, ...IQ },

];
