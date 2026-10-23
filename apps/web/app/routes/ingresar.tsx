import { zodResolver } from "@hookform/resolvers/zod";
import { loginInputSchema, safeReturnTo, type LoginInput } from "@por-aqui/contracts";
import { Alert, Button, Field, Input } from "@por-aqui/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { ArrowRight, Compass } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { FormError, PasswordInput } from "../components/forms";
import { GoogleAlert, GoogleButton } from "../components/google-button";
import { api } from "../lib/api";
import { qk } from "../lib/query";
import { seoMeta } from "../lib/seo";
import type { Route } from "./+types/ingresar";

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Ingresar — Por aquí", noindex: true });
}

export default function Ingresar() {
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get("returnTo"), "/app/inicio");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const form = useForm<LoginInput>({ resolver: zodResolver(loginInputSchema), defaultValues: { email: "", password: "" } });
  const m = useMutation({
    mutationFn: (v: LoginInput) => api.auth.login(v),
    onSuccess: (me) => {
      qc.setQueryData(qk.me, me);
      navigate(me.profile.onboardingCompleted ? returnTo : `/bienvenida?returnTo=${encodeURIComponent(returnTo)}`, { replace: true });
    },
  });
  const { errors } = form.formState;
  return (
    <form onSubmit={form.handleSubmit((v) => m.mutate(v))} noValidate className="flex flex-col gap-4">
      <p className="eyebrow auth-step-label"><Compass size={16} strokeWidth={1.5} aria-hidden="true" /> Tu siguiente aventura te espera</p>
      <h1>Qué bueno verte<br /><em>por aquí.</em></h1>
      <p className="auth-intro">Ingresa a tu cuenta y sigue escribiendo tu historia.</p>
      <GoogleAlert code={params.get("error")} />
      {params.get("verificado") ? <Alert tone="success" title="Correo confirmado">Ya puedes ingresar y publicar tus recorridos.</Alert> : null}
      {params.get("clave") ? <Alert tone="success" title="Contraseña actualizada">Inicia sesión con tu nueva contraseña.</Alert> : null}
      {returnTo !== "/app/inicio" ? <p className="text-sm text-muted-foreground">Ingresa para continuar con lo que estabas haciendo.</p> : null}
      <Field label="Correo electrónico" error={errors.email?.message}>{(c) => <Input {...c} type="email" placeholder="tu@correo.com" autoComplete="email" {...form.register("email")} />}</Field>
      <Field label="Contraseña" error={errors.password?.type === "too_small" ? "Ingresa tu contraseña." : errors.password?.message}>{(c) => <PasswordInput {...c} autoComplete="current-password" {...form.register("password")} />}</Field>
      <FormError error={m.error} />
      <Link to="/recuperar-cuenta" className="-mt-2 self-end text-xs font-medium">¿Olvidaste tu contraseña?</Link>
      <Button type="submit" loading={m.isPending}>Ingresar <ArrowRight size={17} aria-hidden="true" /></Button>
      <GoogleButton mode="login" returnTo={returnTo} />
      <p className="auth-account-link auth-divider">¿Aún no tienes cuenta? <Link to={`/registro?returnTo=${encodeURIComponent(returnTo)}`} className="font-semibold">Empieza tu historia</Link></p>
    </form>
  );
}
