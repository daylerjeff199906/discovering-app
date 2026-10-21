import { Alert, Button, Field, Input } from "@por-aqui/ui";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { FormError } from "../components/forms";
import { ApiError, api } from "../lib/api";
import { seoMeta } from "../lib/seo";
import type { Route } from "./+types/verificar-correo";

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Confirmar correo — Por aquí", noindex: true });
}

function Resend({ initialEmail = "" }: { initialEmail?: string }) {
  const [email, setEmail] = useState(initialEmail);
  const m = useMutation({ mutationFn: () => api.auth.resendVerification(email) });
  return (
    <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }} className="flex flex-col gap-3">
      <Field label="Correo de tu cuenta">{(c) => <Input {...c} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />}</Field>
      <Button type="submit" variant="outline" loading={m.isPending}>Enviar un enlace nuevo</Button>
      {m.isSuccess ? <Alert tone="success">Si existe una cuenta pendiente con ese correo, te enviamos un enlace nuevo. (Espera 1 minuto entre envíos.)</Alert> : null}
      <FormError error={m.error} />
    </form>
  );
}

export default function VerificarCorreo() {
  const [params] = useSearchParams();
  const token = params.get("token");
  // El enlace NO consume el token al abrirse (los escáneres de correo harían un GET): hay que confirmar con un clic.
  const m = useMutation({ mutationFn: () => api.auth.verifyEmail(token!) });
  const err = m.error instanceof ApiError ? m.error : null;

  if (m.isSuccess) {
    return (
      <div className="flex flex-col gap-4" role="status">
        <h1 className="text-2xl">¡Correo confirmado!</h1>
        <p>Tu cuenta quedó verificada. Ya puedes publicar tus recorridos cuando quieras.</p>
        <Link to="/ingresar?verificado=1" className="inline-flex min-h-11 items-center justify-center rounded-control bg-primary px-5 font-semibold text-primary-foreground no-underline">Ingresar</Link>
      </div>
    );
  }
  if (!token) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl">Confirma tu correo</h1>
        <p>Abre el enlace que te enviamos por correo para confirmar tu cuenta. Si no lo encuentras, pide uno nuevo.</p>
        <Resend />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl">Confirma tu correo</h1>
      {err?.code === "TOKEN_EXPIRED" ? (
        <>
          <Alert tone="warning" title="El enlace venció" live="assertive">Pide uno nuevo para continuar.</Alert>
          <Resend />
        </>
      ) : err?.code === "TOKEN_INVALID" ? (
        <>
          <Alert tone="danger" title="El enlace no es válido o ya se usó" live="assertive">Si ya confirmaste tu correo, puedes ingresar. Si no, pide un enlace nuevo.</Alert>
          <Link to="/ingresar" className="font-semibold">Ir a ingresar</Link>
          <Resend />
        </>
      ) : (
        <>
          <p>Pulsa el botón para terminar de verificar tu dirección de correo.</p>
          <FormError error={m.error} />
          <Button loading={m.isPending} onClick={() => m.mutate()}>Confirmar mi correo</Button>
        </>
      )}
    </div>
  );
}
