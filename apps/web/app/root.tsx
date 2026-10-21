import "@fontsource-variable/inter";
import "@fontsource-variable/lora";
import "./app.css";

import { QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteError } from "react-router";
import { ErrorScreen } from "./components/error-screen";
import { makeQueryClient } from "./lib/query";
import { UiStoreProvider } from "./lib/stores";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#f8f5ee" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <Meta />
        <Links />
      </head>
      <body>
        <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-control focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground">
          Saltar al contenido
        </a>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  // Un QueryClient por petición en servidor (nunca compartido entre usuarios) y uno estable en el navegador.
  const [queryClient] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <UiStoreProvider>
        <Outlet />
      </UiStoreProvider>
    </QueryClientProvider>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) return <ErrorScreen kind="not-found" />;
    if (error.status === 401 || error.status === 403) return <ErrorScreen kind="forbidden" />;
    if (error.status === 410) return <ErrorScreen kind="withdrawn" />;
    if (error.status === 503) return <ErrorScreen kind="unavailable" />;
  }
  return <ErrorScreen kind="error" detail={error instanceof Error ? error.message : undefined} />;
}
