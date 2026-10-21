import { zodResolver } from "@hookform/resolvers/zod";
import { resetPasswordInputSchema, type ResetPasswordInput } from "@por-aqui/contracts";
import { Alert, Button, Field } from "@por-aqui/ui";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router";
import { FormError, PasswordInput, PasswordRules } from "../components/forms";
import { ApiError, api, applyFieldErrors } from "../lib/api";
import { seoMeta } from "../lib/seo";
import type { Route } from "./+types/restablecer-clave";

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Nueva contraseña — Por aquí", noindex: true });
}

export default function RestablecerClave() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();
  const form = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordInputSchema), defaultValues: { token, password: "", passwordConfirm: "" } });
  const m = useMutation({
    mutationFn: (v: ResetPasswordInput) => api.auth.resetPassword(v),
    onSuccess: () => navigate("/ingresar?clave=1", { replace: true }),
    onError: (e) => applyFieldErrors(e, form.setError),
  });
  const { errors } = form.formState;
  const err = m.error instanceof ApiError ? m.error : null;

  if (!token) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-2xl">Enlace incompleto</h1>
        <p>Abre el enlace completo que te enviamos por correo o pide uno nuevo.</p>
        <Link to="/recuperar-cuenta" className="font-semibold">Pedir un enlace nuevo</Link>
      </div>
    );
  }
  return (
    <form onSubmit={form.handleSubmit((v) => m.mutate({ ...v, token }))} noValidate className="flex flex-col gap-4">
      <h1 className="text-2xl">Elige una nueva contraseña</h1>
      {err && (err.code === "TOKEN_EXPIRED" || err.code === "TOKEN_INVALID") ? (
        <Alert tone="danger" title={err.code === "TOKEN_EXPIRED" ? "El enlace venció" : "El enlace no es válido o ya se usó"} live="assertive">
          <Link to="/recuperar-cuenta" className="font-semibold">Pedir un enlace nuevo</Link>
        </Alert>
      ) : null}
      <Field label="Nueva contraseña" error={errors.password?.message}>{(c) => <PasswordInput {...c} autoComplete="new-password" {...form.register("password")} />}</Field>
      <PasswordRules value={form.watch("password")} />
      <Field label="Confirmar contraseña" error={errors.passwordConfirm?.message}>{(c) => <PasswordInput {...c} autoComplete="new-password" {...form.register("passwordConfirm")} />}</Field>
      <FormError error={err && (err.code === "TOKEN_EXPIRED" || err.code === "TOKEN_INVALID") ? null : m.error} />
      <p className="text-sm text-muted-foreground">Al cambiarla cerraremos tus sesiones abiertas en otros dispositivos.</p>
      <Button type="submit" loading={m.isPending}>Guardar contraseña</Button>
    </form>
  );
}
