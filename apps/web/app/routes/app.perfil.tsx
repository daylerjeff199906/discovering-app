import { zodResolver } from "@hookform/resolvers/zod";
import { updateProfileInputSchema, type UpdateProfileInput } from "@por-aqui/contracts";
import { uploadToStorage } from "@por-aqui/api-client";
import { Alert, Avatar, Button, Field, Input, Textarea, buttonClass, cn } from "@por-aqui/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { z } from "zod";
import { FormError } from "../components/forms";
import { LoadingBlock, PageHeader } from "../components/shell";
import { api, applyFieldErrors, errorMessage } from "../lib/api";
import { useMe } from "../lib/auth";
import { interestsQuery, qk } from "../lib/query";
import { seoMeta } from "../lib/seo";
import type { Route } from "./+types/app.perfil";

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Perfil — Por aquí", noindex: true });
}

const formSchema = updateProfileInputSchema.pick({ displayName: true, username: true, bio: true }).extend({ displayName: z.string().trim().min(1, "Requerido").max(60), username: z.string().regex(/^[A-Za-z0-9_]{3,24}$/, "3–24 caracteres: letras, números y guion bajo"), bio: z.string().max(280).optional() });
type Form = z.infer<typeof formSchema>;

export default function Perfil() {
  const { me } = useMe();
  const qc = useQueryClient();
  const interests = useQuery(interestsQuery());
  const [chosen, setChosen] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatar, setAvatar] = useState<{ busy: boolean; error?: string; ok?: boolean }>({ busy: false });
  const form = useForm<Form>({ resolver: zodResolver(formSchema), defaultValues: { displayName: "", username: "", bio: "" } });

  useEffect(() => {
    if (me) {
      form.reset({ displayName: me.profile.displayName, username: me.profile.username, bio: me.profile.bio ?? "" });
      setChosen(me.profile.interests);
    }
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useMutation({
    mutationFn: (v: Form) => api.me.updateProfile({ displayName: v.displayName, username: v.username, bio: v.bio?.trim() ? v.bio.trim() : null, interests: chosen } satisfies UpdateProfileInput),
    onSuccess: (m) => { qc.setQueryData(qk.me, m); setSaved(true); setTimeout(() => setSaved(false), 2500); },
    onError: (e) => applyFieldErrors(e, form.setError),
  });

  const upload = async (file: File) => {
    setAvatar({ busy: true });
    try {
      const auth = await api.me.avatarUpload({ mimeType: file.type as "image/jpeg", sizeBytes: file.size });
      await uploadToStorage(auth, file);
      let a = await api.media.complete(auth.assetId);
      for (let i = 0; i < 20 && a.status !== "READY" && a.status !== "FAILED"; i++) {
        await new Promise((r) => setTimeout(r, 800));
        a = await api.media.status(auth.assetId);
      }
      if (a.status !== "READY") throw new Error(a.status === "FAILED" ? "No pudimos procesar esa imagen (usa JPEG, PNG o WebP)." : "Sigue procesándose; recarga en unos segundos.");
      await qc.invalidateQueries({ queryKey: qk.me });
      setAvatar({ busy: false, ok: true });
    } catch (e) {
      setAvatar({ busy: false, error: errorMessage(e, (e as Error).message) });
    }
  };

  if (!me) return <LoadingBlock />;
  const { errors } = form.formState;
  return (
    <>
      <PageHeader title="Tu perfil" subtitle="Esto es lo que ven los demás en tus historias públicas. Tu correo nunca se muestra." actions={<Link to={`/u/${me.profile.username}`} className={buttonClass({ variant: "outline" })}>Ver mi perfil público</Link>} />
      <div className="grid max-w-3xl gap-8">
        <div className="flex items-center gap-4">
          <Avatar name={me.profile.displayName} src={me.profile.avatarUrl} size={80} />
          <div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Elegir foto de perfil" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); e.target.value = ""; }} />
            <Button variant="outline" size="sm" loading={avatar.busy} onClick={() => fileRef.current?.click()}>Cambiar foto de perfil</Button>
            <p role="status" className="mt-1 text-sm text-success">{avatar.ok ? "Foto actualizada." : ""}</p>
            {avatar.error ? <p role="alert" className="mt-1 text-sm text-danger">{avatar.error}</p> : null}
          </div>
        </div>
        <form onSubmit={form.handleSubmit((v) => save.mutate(v))} noValidate className="flex flex-col gap-4">
          <Field label="Nombre visible" error={errors.displayName?.message} required>{(c) => <Input {...c} {...form.register("displayName")} />}</Field>
          <Field label="Usuario" hint={`Tu perfil: /u/${form.watch("username") || "usuario"}`} error={errors.username?.message} required>{(c) => <Input {...c} autoCapitalize="none" {...form.register("username")} />}</Field>
          <Field label="Sobre ti" error={errors.bio?.message}>{(c) => <Textarea {...c} rows={3} maxLength={280} {...form.register("bio")} />}</Field>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Intereses</legend>
            <div className="flex flex-wrap gap-2">
              {interests.data?.map((i) => {
                const on = chosen.includes(i.slug);
                return <button key={i.slug} type="button" aria-pressed={on} onClick={() => setChosen(on ? chosen.filter((x) => x !== i.slug) : [...chosen, i.slug])} className={cn("min-h-10 rounded-full border px-3.5 text-sm font-medium", on ? "border-primary bg-sage text-sage-foreground" : "border-control-border bg-surface")}>{on ? "✓ " : "+ "}{i.label}</button>;
              })}
            </div>
          </fieldset>
          <FormError error={save.error && !(save.error as { fieldErrors?: object }).fieldErrors ? save.error : null} />
          {save.isError && (save.error as { code?: string }).code === "USERNAME_TAKEN" ? <Alert tone="danger" live="assertive">Ese nombre de usuario ya está en uso.</Alert> : null}
          <div className="flex items-center gap-3">
            <Button type="submit" loading={save.isPending}>Guardar cambios</Button>
            <span role="status" className="text-sm font-semibold text-success">{saved ? "Guardado ✓" : ""}</span>
          </div>
        </form>
        <p className="text-sm text-muted-foreground">Preferencias de idioma y zona horaria: {me.profile.locale} · {me.profile.timezone}. <Link to="/bienvenida">Cambiar</Link></p>
      </div>
    </>
  );
}
