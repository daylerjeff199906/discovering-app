import { invalidFile } from "./types";

export interface XmlNode {
  /** Nombre local (sin prefijo de espacio de nombres: `gx:Track` → `Track`). */
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

const MAX_DEPTH = 64;
const MAX_NODES = 1_000_000;

const NAMED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** Solo entidades predefinidas y numéricas; cualquier otra se deja tal cual (nunca se resuelve nada externo). */
function decode(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[a-z]{2,4});/g, (m, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED[body] ?? m;
  });
}

const isSpace = (c: string) => c === " " || c === "\n" || c === "\t" || c === "\r";
const localName = (raw: string) => raw.slice(raw.indexOf(":") + 1);

/**
 * Lector XML mínimo y seguro para GPX/KML. No es un parser general: rechaza de entrada cualquier
 * `<!DOCTYPE>` o `<!ENTITY>` (única vía de XXE y de "billion laughs"), no resuelve entidades externas ni
 * carga recursos, y acota profundidad y número de nodos.
 */
export function parseXml(input: string): XmlNode {
  const src = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  if (/<!DOCTYPE|<!ENTITY/i.test(src)) {
    throw invalidFile("El archivo XML declara un DOCTYPE o entidades, que no admitimos por seguridad. Expórtalo de nuevo sin ellos.");
  }
  function fail(what: string): never {
    throw invalidFile(`El archivo XML no es válido (${what}).`);
  }

  const stack: { node: XmlNode; raw: string }[] = [];
  let root: XmlNode | null = null;
  let nodes = 0;
  let i = 0;
  const n = src.length;

  while (i < n) {
    const lt = src.indexOf("<", i);
    const text = src.slice(i, lt === -1 ? n : lt);
    if (text) {
      const top = stack[stack.length - 1];
      if (top) top.node.text += decode(text);
      else if (text.trim()) fail("hay texto fuera del elemento raíz");
    }
    if (lt === -1) break;
    i = lt;

    if (src.startsWith("<!--", i)) {
      const end = src.indexOf("-->", i + 4);
      if (end === -1) fail("comentario sin cerrar");
      i = end + 3;
    } else if (src.startsWith("<![CDATA[", i)) {
      const end = src.indexOf("]]>", i + 9);
      const top = stack[stack.length - 1];
      if (end === -1 || !top) fail("CDATA inválido");
      else top.node.text += src.slice(i + 9, end);
      i = end + 3;
    } else if (src.startsWith("<?", i)) {
      const end = src.indexOf("?>", i + 2);
      if (end === -1) fail("instrucción sin cerrar");
      i = end + 2;
    } else if (src.startsWith("<!", i)) {
      fail("declaración no admitida");
    } else if (src.startsWith("</", i)) {
      const end = src.indexOf(">", i);
      if (end === -1) fail("etiqueta de cierre sin terminar");
      const top = stack.pop();
      if (!top || top.raw !== src.slice(i + 2, end).trim()) fail("etiquetas mal anidadas");
      i = end + 1;
    } else {
      // Etiqueta de apertura: nombre, atributos y `>` o `/>`.
      let j = i + 1;
      while (j < n && !isSpace(src[j]!) && src[j] !== ">" && src[j] !== "/") j++;
      const raw = src.slice(i + 1, j);
      if (!raw) fail("etiqueta sin nombre");
      const attrs: Record<string, string> = {};
      let selfClosing = false;
      for (;;) {
        while (j < n && isSpace(src[j]!)) j++;
        if (j >= n) fail("etiqueta sin cerrar");
        if (src[j] === ">") {
          j++;
          break;
        }
        if (src[j] === "/") {
          if (src[j + 1] !== ">") fail("etiqueta mal formada");
          selfClosing = true;
          j += 2;
          break;
        }
        const nameStart = j;
        while (j < n && !isSpace(src[j]!) && src[j] !== "=" && src[j] !== ">" && src[j] !== "/") j++;
        const attrName = src.slice(nameStart, j);
        while (j < n && isSpace(src[j]!)) j++;
        if (src[j] !== "=" || !attrName) fail("atributo mal formado");
        j++;
        while (j < n && isSpace(src[j]!)) j++;
        const quote = src[j];
        if (quote !== '"' && quote !== "'") fail("atributo sin comillas");
        const close = src.indexOf(quote!, j + 1);
        if (close === -1) fail("atributo sin cerrar");
        attrs[localName(attrName)] = decode(src.slice(j + 1, close));
        j = close + 1;
      }
      if (++nodes > MAX_NODES) throw invalidFile("El archivo XML tiene demasiados elementos.");
      const node: XmlNode = { name: localName(raw), attrs, children: [], text: "" };
      const parent = stack[stack.length - 1];
      if (parent) parent.node.children.push(node);
      else if (root) fail("hay más de un elemento raíz");
      else root = node;
      if (!selfClosing) {
        if (stack.length >= MAX_DEPTH) throw invalidFile("El archivo XML está anidado demasiado profundo.");
        stack.push({ node, raw });
      }
      i = j;
    }
  }
  if (stack.length) fail("hay elementos sin cerrar");
  if (!root) fail("está vacío");
  return root!;
}

/** Hijos directos con ese nombre local. */
export const kids = (node: XmlNode, name: string) => node.children.filter((c) => c.name === name);
export const kid = (node: XmlNode, name: string) => node.children.find((c) => c.name === name);
export const textOf = (node: XmlNode | undefined) => node?.text.trim() ?? "";

/** Todos los descendientes con ese nombre (recorrido iterativo, sin recursión profunda). */
export function descendants(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const todo = [...node.children].reverse();
  while (todo.length) {
    const cur = todo.pop()!;
    if (cur.name === name) out.push(cur);
    for (let k = cur.children.length - 1; k >= 0; k--) todo.push(cur.children[k]!);
  }
  return out;
}
