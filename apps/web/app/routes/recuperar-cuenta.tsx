import { zodResolver } from "@hookform/resolvers/zod";
import { forgotPasswordInputSchema } from "@por-aqui/contracts";
import { Alert, Button, Field, Input } from "@por-aqui/ui";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import type { z } from "zod";
import { FormError } from "../components/forms";
import { api } from "../lib/api";
import { seoMeta } from "../lib/seo";
import type { Route } from "./+types/recuperar-cuenta";

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Recuperar cuenta — Por aquí", noindex: true });
}

type Input_ = z.input<typeof forgotPasswordInputSchema>;

export default function RecuperarCuenta() {
  const form = useForm<Input_>({ resolver: zodResolver(forgotPasswordInputSchema), defaultValues: { email: "" } });
  const m = useMutation({ mutationFn: (v: Input_) => api.auth.forgotPassword(v.email) });
  if (m.isSuccess) {
    return (
      <div className="flex flex-col gap-4" role="status">
        <h1 className="text-2xl">Revisa tu correo</h1>
        <Alert tone="success">Si existe una cuenta con ese correo, te enviamos un enlace para elegir una nueva contraseña. Vence en 1 hora.</Alert>
        <Link to="/ingresar" className="font-semibold">Volver a ingresar</Link>
      </div>
    );
  }
  return (
    <form onSubmit={form.handleSubmit((v) => m.mutate(v))} noValidate className="flex flex-col gap-4">
      <h1 className="text-2xl">Recuperar cuenta</h1>
      <p className="text-sm text-muted-foreground">Escribe el correo de tu cuenta y te enviaremos un enlace.</p>
      <Field label="Correo electrónico" error={form.formState.errors.email?.message}>{(c) => <Input {...c} type="email" autoComplete="email" {...form.register("email")} />}</Field>
      <FormError error={m.error} />
      <Button type="submit" loading={m.isPending}>Enviar enlace</Button>
      <Link to="/ingresar" className="text-center text-sm font-semibold">Volver a ingresar</Link>
    </form>
  );
}
