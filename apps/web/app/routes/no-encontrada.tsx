import { data } from "react-router";
import { ErrorScreen } from "../components/error-screen";
import { seoMeta } from "../lib/seo";

export function loader() {
  throw data("No encontrado", { status: 404 });
}

export function meta() {
  return seoMeta({ title: "Página no encontrada — Por aquí", noindex: true });
}

export default function NoEncontrada() {
  return <ErrorScreen kind="not-found" />;
}
