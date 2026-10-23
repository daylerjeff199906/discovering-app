import { zodResolver } from "@hookform/resolvers/zod";
import { TERMS_VERSION, registerInputSchema, safeReturnTo, type RegisterInput } from "@por-aqui/contracts";
import { Button, Field, Input } from "@por-aqui/ui";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useSearchParams } from "react-router";
import { ArrowRight, MailCheck, MapPinned } from "lucide-react";
import { Checkbox, FormError, PasswordInput, PasswordRules } from "../components/forms";
import { GoogleAlert, GoogleButton } from "../components/google-button";
import { api, applyFieldErrors } from "../lib/api";
import { seoMeta } from "../lib/seo";
import type { Route } from "./+types/registro";

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Crear cuenta — Por aquí", noindex: true });
}

function CheckEmail({ email, returnTo }: { email: string; returnTo: string }) {
  const [cooldown, setCooldown] = useState(60);
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);
  const resend = useMutation({ mutationFn: () => api.auth.resendVerification(email), onSuccess: () => { setSent(true); setCooldown(60); } });
  return (
    <div className="flex flex-col gap-4" role="status">
      <span className="flex size-16 items-center justify-center rounded-full bg-sage"><MailCheck size={28} strokeWidth={1.4} aria-hidden="true" /></span>
      <p className="eyebrow mt-3">Solo un paso más</p>
      <h1>Un mensaje para<br /><em>empezar la aventura.</em></h1>
      <p>Te enviamos un enlace de confirmación a <strong>{email}</strong>. Ábrelo y pulsa «Confirmar mi correo». El enlace vence en 24 horas.</p>
      <p className="text-sm text-muted-foreground">Si no lo ves, mira en spam. Por seguridad, si ese correo ya tenía cuenta te avisaremos por correo en lugar de crear otra.</p>
      <Button variant="outline" disabled={cooldown > 0} loading={resend.isPending} onClick={() => resend.mutate()}>
        {cooldown > 0 ? `Reenviar en ${cooldown} s` : "Reenviar correo"}
      </Button>
      {sent ? <p className="text-sm font-semibold text-success">Enviamos un nuevo enlace.</p> : null}
      <FormError error={resend.error} />
      <Link to={`/ingresar?returnTo=${encodeURIComponent(returnTo)}`} className="font-semibold">Ya confirmé mi correo → ingresar</Link>
    </div>
  );
}

export default function Registro() {
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get("returnTo"), "/app/inicio");
  const [done, setDone] = useState<string | null>(null);
  const form = useForm<RegisterInput>({
    resolver: zodResolver(registerInputSchema),
    mode: "onBlur",
    defaultValues: { displayName: "", username: "", email: "", password: "", passwordConfirm: "", acceptTerms: undefined as never, termsVersion: TERMS_VERSION },
  });
  const m = useMutation({
    mutationFn: (v: RegisterInput) => api.auth.register(v),
    onSuccess: (_r, v) => setDone(v.email),
    onError: (err) => applyFieldErrors(err, form.setError),
  });
  const { errors } = form.formState;

  if (done) return <CheckEmail email={done} returnTo={returnTo} />;
  return (
    <form onSubmit={form.handleSubmit((v) => m.mutate(v))} noValidate className="flex flex-col gap-4">
      <p className="eyebrow auth-step-label"><MapPinned size={16} strokeWidth={1.5} aria-hidden="true" /> El primer paso de muchos</p>
      <h1>Hay historias que<br /><em>empiezan contigo.</em></h1>
      <p className="auth-intro">Crea tu cuenta para planear, explorar y guardar lo vivido.</p>
      <GoogleAlert code={params.get("error")} />
      <div className="auth-name-grid">
      <Field label="Tu nombre" error={errors.displayName?.message} required>{(c) => <Input {...c} placeholder="¿Cómo te llamas?" autoComplete="name" {...form.register("displayName")} />}</Field>
      <Field label="Nombre de usuario" hint="3–24 letras, números o guion bajo." error={errors.username?.message} required>{(c) => <Input {...c} placeholder="tu_nombre" autoComplete="username" autoCapitalize="none" {...form.register("username")} />}</Field>
      </div>
      <Field label="Correo electrónico" error={errors.email?.message} required>{(c) => <Input {...c} type="email" placeholder="tu@correo.com" autoComplete="email" {...form.register("email")} />}</Field>
      <Field label="Contraseña" error={errors.password?.message} required>{(c) => <PasswordInput {...c} autoComplete="new-password" {...form.register("password")} />}</Field>
      <PasswordRules value={form.watch("password")} />
      <Field label="Confirmar contraseña" error={errors.passwordConfirm?.message} required>{(c) => <PasswordInput {...c} autoComplete="new-password" {...form.register("passwordConfirm")} />}</Field>
      <Checkbox label={<>Acepto los <a href="/terminos" target="_blank" rel="noreferrer">términos de la beta</a>.</>} error={errors.acceptTerms?.message} {...form.register("acceptTerms")} />
      <FormError error={m.error && !(m.error as { fieldErrors?: object }).fieldErrors ? m.error : null} />
      <Button type="submit" loading={m.isPending}>Crear mi cuenta <ArrowRight size={17} aria-hidden="true" /></Button>
      <GoogleButton mode="register" returnTo={returnTo} termsAccepted={Boolean(form.watch("acceptTerms"))} />
      <p className="auth-account-link auth-divider">¿Ya tienes cuenta? <Link to={`/ingresar?returnTo=${encodeURIComponent(returnTo)}`} className="font-semibold">Ingresar</Link></p>
    </form>
  );
}
