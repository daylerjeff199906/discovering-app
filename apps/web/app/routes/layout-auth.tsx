import { Outlet } from "react-router";
import { Logo } from "../components/shell";

export default function LayoutAuth() {
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 py-8">
      <Logo className="mb-6" />
      <main id="contenido" tabIndex={-1} className="w-full max-w-md rounded-card border border-border bg-surface p-6 shadow-card outline-none sm:p-8">
        <Outlet />
      </main>
      <p className="mt-6 text-center text-sm text-muted-foreground">Tus recorridos son privados hasta que decidas compartirlos.</p>
    </div>
  );
}
