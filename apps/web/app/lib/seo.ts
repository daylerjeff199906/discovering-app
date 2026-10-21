/** Metadatos por ruta: se generan en el servidor (no basta con cambiar document.title después de cargar). */
export interface SeoInput {
  title: string;
  description?: string | null;
  /** URL absoluta canónica. Para historias por enlace NO se publica (noindex). */
  canonical?: string | null;
  image?: string | null;
  noindex?: boolean;
  type?: "website" | "article" | "profile";
}

type MetaDescriptor = Record<string, unknown>;

export function seoMeta(input: SeoInput): MetaDescriptor[] {
  const description = input.description?.replace(/\s+/g, " ").trim().slice(0, 200);
  const tags: MetaDescriptor[] = [{ title: input.title }];
  if (description) tags.push({ name: "description", content: description });
  tags.push({ property: "og:title", content: input.title }, { property: "og:type", content: input.type ?? "website" }, { property: "og:site_name", content: "Por aquí" });
  if (description) tags.push({ property: "og:description", content: description });
  if (input.canonical) tags.push({ tagName: "link", rel: "canonical", href: input.canonical }, { property: "og:url", content: input.canonical });
  if (input.image) tags.push({ property: "og:image", content: input.image });
  tags.push({ name: "twitter:card", content: input.image ? "summary_large_image" : "summary" });
  if (input.noindex) tags.push({ name: "robots", content: "noindex, nofollow, noarchive" });
  return tags;
}

export function siteUrl(): string {
  return (typeof process !== "undefined" ? process.env.PUBLIC_SITE_URL : undefined)?.replace(/\/$/, "") ?? "http://localhost:5173";
}

/** Las imágenes de OG deben ser absolutas; solo se usan las de publicaciones PUBLIC. */
export function absoluteUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${siteUrl()}${path}`;
}
