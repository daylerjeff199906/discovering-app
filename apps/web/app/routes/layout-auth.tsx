import { ArrowLeft, ArrowUpRight, MapPin, ShieldCheck } from "lucide-react";
import { Link, Outlet, useLocation } from "react-router";
import { safeReturnTo } from "@por-aqui/contracts";
import { Logo } from "../components/shell";
import { travelPhotos } from "../lib/travel-photos";

export default function LayoutAuth() {
  const { pathname, search } = useLocation();
  const register = pathname === "/registro";
  const returnTo = safeReturnTo(new URLSearchParams(search).get("returnTo"), "/app/inicio");
  const authSearch = `?returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <div className="auth-page">
      <aside className="auth-story" aria-label="Viajes que dejan huella">
        <img src={travelPhotos.plaza} alt="" width={1800} height={1200} />
        <Logo />
        <div className="auth-story-copy">
          <p className="eyebrow">Un camino. Mil recuerdos.</p>
          <h2>
            {register ? (
              <>
                Tu próxima historia
                <br />
                empieza por aquí.
              </>
            ) : (
              <>
                Vuelve a ese lugar
                <br />
                que te hizo sentir.
              </>
            )}
          </h2>
          <p>
            Descubre lugares, haz tu propio camino y guarda esos pequeños
            momentos que hacen grande una aventura.
          </p>
        </div>
        <div className="auth-story-bottom">
          <span>
            <MapPin size={13} aria-hidden="true" /> Iquitos, Loreto, Perú
          </span>
          <span>Explora. Siente. Recuerda.</span>
        </div>
      </aside>
      <div className="auth-content">
        <div className="auth-topline">
          <Link to="/">
            <ArrowLeft size={14} aria-hidden="true" /> Volver a explorar
          </Link>
          <Link to={`${register ? "/ingresar" : "/registro"}${authSearch}`}>
            {register ? "Ya tengo cuenta" : "Crear una cuenta"}
            <ArrowUpRight size={13} aria-hidden="true" />
          </Link>
        </div>
        <main
          id="contenido"
          tabIndex={-1}
          className="auth-form-container outline-none"
        >
          <Outlet />
          <p className="auth-privacy">
            <ShieldCheck size={14} aria-hidden="true" /> Tus recuerdos son
            privados hasta que tú decidas compartirlos.
          </p>
          <p className="mt-3 text-center text-[10px] text-muted-foreground">
            <a href="/images/creditos.html">Fotografía de Iquitos · créditos</a>
          </p>
        </main>
      </div>
    </div>
  );
}
