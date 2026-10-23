import { zodResolver } from "@hookform/resolvers/zod";
import { changePasswordInputSchema, type ChangePasswordInput } from "@por-aqui/contracts";
import { Alert, Badge, Button, Card, Dialog, Field, Input } from "@por-aqui/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router";
import { FormError, PasswordInput, PasswordRules } from "../components/forms";
import { LoadingBlock, PageHeader } from "../components/shell";
import { api, applyFieldErrors, errorMessage } from "../lib/api";
import { useMe } from "../lib/auth";
import { formatDateTime } from "../lib/format";
import { hasPendingData } from "../lib/offline-queue";
import { qk } from "../lib/query";
import { seoMeta } from "../lib/seo";
import type { Route } from "./+types/app.cuenta";

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Cuenta — Por aquí", noindex: true });
}

export default function Cuenta() {
  const { me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const sessions = useQuery({ queryKey: qk.sessions, queryFn: ({ signal }) => api.auth.sessions({ signal }) });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pwd, setPwd] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pendingLocal, setPendingLocal] = useState(false);
  const [changed, setChanged] = useState(false);
  const [resent, setResent] = useState(false);
  useEffect(() => { if (me) void hasPendingData(me.id).then(setPendingLocal); }, [me]);

  const form = useForm<ChangePasswordInput>({ resolver: zodResolver(changePasswordInputSchema), defaultValues: { currentPassword: "", newPassword: "", newPasswordConfirm: "" } });
  const change = useMutation({
    mutationFn: (v: ChangePasswordInput) => api.me.changePassword(v),
    onSuccess: () => { form.reset(); setChanged(true); void sessions.refetch(); },
    onError: (e) => applyFieldErrors(e, form.setError),
  });
  const revoke = useMutation({ mutationFn: (id: string) => api.auth.revokeSession(id), onSuccess: () => sessions.refetch() });
  const revokeOthers = useMutation({ mutationFn: () => api.auth.revokeOtherSessions(), onSuccess: () => sessions.refetch() });
  const resend = useMutation({ mutationFn: () => api.auth.resendVerification(me!.email), onSuccess: () => setResent(true) });
  const del = useMutation({
    mutationFn: () => api.me.deleteAccount({ password: pwd, confirmation: "ELIMINAR" }),
    onSuccess: () => { qc.clear(); navigate("/?cuenta=eliminada", { replace: true }); },
  });

  if (!me) return <LoadingBlock />;
  const { errors } = form.formState;
  return (
    <>
      <PageHeader title="Tu cuenta" subtitle="Seguridad, sesiones y privacidad." />
      <div className="grid max-w-3xl gap-6">
        <Card className="p-5">
          <h2 className="text-xl">Correo</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2">{me.email} {me.emailVerified ? <Badge tone="success">Verificado</Badge> : <Badge tone="warning">Sin verificar</Badge>}</p>
          {!me.emailVerified ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button size="sm" variant="outline" loading={resend.isPending} onClick={() => resend.mutate()}>Reenviar correo de verificación</Button>
              {resent ? <span role="status" className="text-sm font-semibold text-success">Enviado.</span> : null}
              <FormError error={resend.error} />
            </div>
          ) : null}
        </Card>

        <Card className="p-5">
          <h2 className="text-xl">Cambiar contraseña</h2>
          <form onSubmit={form.handleSubmit((v) => change.mutate(v))} noValidate className="mt-3 flex max-w-md flex-col gap-4">
            <Field label="Contraseña actual" error={errors.currentPassword?.message}>{(c) => <PasswordInput {...c} autoComplete="current-password" {...form.register("currentPassword")} />}</Field>
            <Field label="Nueva contraseña" error={errors.newPassword?.message}>{(c) => <PasswordInput {...c} autoComplete="new-password" {...form.register("newPassword")} />}</Field>
            <PasswordRules value={form.watch("newPassword")} />
            <Field label="Confirmar nueva contraseña" error={errors.newPasswordConfirm?.message}>{(c) => <PasswordInput {...c} autoComplete="new-password" {...form.register("newPasswordConfirm")} />}</Field>
            {changed ? <Alert tone="success">Contraseña actualizada. Cerramos tus otras sesiones.</Alert> : null}
            <FormError error={change.error && !(change.error as { fieldErrors?: object }).fieldErrors ? change.error : null} />
            <div><Button type="submit" loading={change.isPending}>Cambiar contraseña</Button></div>
          </form>
        </Card>

        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl">Sesiones activas</h2>
            <Button size="sm" variant="outline" loading={revokeOthers.isPending} disabled={(sessions.data?.length ?? 0) < 2} onClick={() => revokeOthers.mutate()}>Cerrar las demás</Button>
          </div>
          {sessions.isPending ? <LoadingBlock /> : null}
          <ul className="m-0 mt-3 flex list-none flex-col divide-y divide-border p-0">
            {sessions.data?.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <p className="font-semibold">{s.userAgentLabel ?? "Dispositivo"} {s.current ? <Badge tone="sage">Esta sesión</Badge> : null}</p>
                  <p className="text-sm text-muted-foreground">Último uso {formatDateTime(s.lastSeenAt)} · vence {formatDateTime(s.expiresAt)}</p>
                </div>
                {!s.current ? <Button size="sm" variant="ghost" loading={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id)}>Revocar</Button> : null}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5">
          <h2 className="text-xl">Privacidad</h2>
          <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
            <li>Tus aventuras, visitas, fotos y notas son privadas por omisión.</li>
            <li>Al publicar eliges qué se muestra; el trayecto GPS exacto está desactivado por omisión.</li>
            <li>Nunca mostramos tu correo ni tus fotos originales (con EXIF).</li>
          </ul>
        </Card>

        <Card className="border-danger/40 p-5">
          <h2 className="text-xl text-danger">Eliminar cuenta</h2>
          <p className="mt-1 text-sm text-muted-foreground">Cierra tus sesiones, retira tus publicaciones y borra tus datos y archivos. No se puede deshacer.</p>
          <Button className="mt-3" variant="danger" onClick={() => setDeleteOpen(true)}>Eliminar mi cuenta…</Button>
        </Card>
      </div>

      <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title="Eliminar tu cuenta" description="Esta acción es permanente."
        footer={<><Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancelar</Button><Button variant="danger" disabled={confirmation !== "ELIMINAR" || !pwd} loading={del.isPending} onClick={() => del.mutate()}>Eliminar definitivamente</Button></>}>
        <div className="flex flex-col gap-4">
          {pendingLocal ? <Alert tone="warning" title="Hay datos sin sincronizar en este dispositivo">Si eliminas la cuenta se perderán visitas o puntos que aún no se enviaron.</Alert> : null}
          <Field label="Tu contraseña">{(c) => <PasswordInput {...c} value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="current-password" />}</Field>
          <Field label="Escribe ELIMINAR para confirmar">{(c) => <Input {...c} value={confirmation} onChange={(e) => setConfirmation(e.target.value)} autoComplete="off" />}</Field>
          {del.isError ? <Alert tone="danger" live="assertive">{errorMessage(del.error)}</Alert> : null}
        </div>
      </Dialog>
    </>
  );
}
