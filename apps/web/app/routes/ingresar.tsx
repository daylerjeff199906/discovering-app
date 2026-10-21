import { zodResolver } from "@hookform/resolvers/zod";
import { loginInputSchema, safeReturnTo, type LoginInput } from "@por-aqui/contracts";
import { Alert, Button, Field, Input } from "@por-aqui/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router";
import { FormError, PasswordInput } from "../components/forms";
import { api } from "../lib/api";
import { qk } from "../lib/query";
import { seoMeta } from "../lib/seo";
import type { Route } from "./+types/ingresar";

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Ingresar — Por aquí", noindex: true });
}

export default function Ingresar() {
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get("returnTo"));
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
      <h1 className="text-2xl">Ingresar</h1>
      {params.get("verificado") ? <Alert tone="success" title="Correo confirmado">Ya puedes ingresar y publicar tus recorridos.</Alert> : null}
      {params.get("clave") ? <Alert tone="success" title="Contraseña actualizada">Inicia sesión con tu nueva contraseña.</Alert> : null}
      {returnTo !== "/app/viajes" ? <p className="text-sm text-muted-foreground">Ingresa para continuar con lo que estabas haciendo.</p> : null}
      <Field label="Correo electrónico" error={errors.email?.message}>{(c) => <Input {...c} type="email" autoComplete="email" {...form.register("email")} />}</Field>
      <Field label="Contraseña" error={errors.password?.message}>{(c) => <PasswordInput {...c} autoComplete="current-password" {...form.register("password")} />}</Field>
      <FormError error={m.error} />
      <Button type="submit" loading={m.isPending}>Ingresar</Button>
      <div className="flex flex-wrap justify-between gap-2 text-sm">
        <Link to="/recuperar-cuenta" className="font-semibold">¿Olvidaste tu contraseña?</Link>
        <Link to={`/registro?returnTo=${encodeURIComponent(returnTo)}`} className="font-semibold">Crear cuenta</Link>
      </div>
    </form>
  );
}
