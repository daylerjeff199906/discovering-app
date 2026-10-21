import { safeReturnTo } from "@por-aqui/contracts";
import { uploadToStorage } from "@por-aqui/api-client";
import { Alert, Avatar, Button, Field, Select, cn } from "@por-aqui/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { PageHeader } from "../components/shell";
import { api, errorMessage } from "../lib/api";
import { useMe } from "../lib/auth";
import { browserTimezone } from "../lib/format";
import { interestsQuery, qk } from "../lib/query";
import { seoMeta } from "../lib/seo";
import type { Route } from "./+types/bienvenida";

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Bienvenida — Por aquí", noindex: true });
}

const zones = () => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["America/Lima", "America/Bogota", "America/Mexico_City", "Europe/Madrid", "UTC"];
  }
};

/** Onboarding breve y omisible. No pide ubicación precisa. */
export default function Bienvenida() {
  const { me } = useMe();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get("returnTo"));
  const navigate = useNavigate();
  const qc = useQueryClient();
  const interests = useQuery(interestsQuery());
  const [locale, setLocale] = useState(me?.profile.locale ?? "es");
  const [timezone, setTimezone] = useState(me?.profile.timezone && me.profile.timezone !== "America/Lima" ? me.profile.timezone : browserTimezone());
  const [chosen, setChosen] = useState<string[]>(me?.profile.interests ?? []);
  const [avatarState, setAvatarState] = useState<"idle" | "uploading" | "processing" | "ready" | "error">("idle");
  const [avatarMsg, setAvatarMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const save = useMutation({
    mutationFn: (skip: boolean) => api.me.updateProfile(skip ? { completeOnboarding: true } : { locale, timezone, interests: chosen, completeOnboarding: true }),
    onSuccess: (m) => { qc.setQueryData(qk.me, m); navigate(returnTo, { replace: true }); },
  });

  const uploadAvatar = async (file: File) => {
    setAvatarState("uploading");
    setAvatarMsg("");
    try {
      const auth = await api.me.avatarUpload({ mimeType: file.type as "image/jpeg", sizeBytes: file.size });
      await uploadToStorage(auth, file);
      let asset = await api.media.complete(auth.assetId);
      setAvatarState("processing");
      for (let i = 0; i < 20 && asset.status !== "READY" && asset.status !== "FAILED"; i++) {
        await new Promise((r) => setTimeout(r, 800));
        asset = await api.media.status(auth.assetId);
      }
      if (asset.status === "READY") {
        await qc.invalidateQueries({ queryKey: qk.me });
        setAvatarState("ready");
      } else {
        setAvatarState("error");
        setAvatarMsg(asset.status === "FAILED" ? "No pudimos procesar esa imagen. Prueba con otra (JPEG, PNG o WebP)." : "Tarda más de lo normal. Puedes seguir y revisarlo luego en tu perfil.");
      }
    } catch (e) {
      setAvatarState("error");
      setAvatarMsg(errorMessage(e, "No pudimos subir la imagen."));
    }
  };

  return (
    <>
      <PageHeader title={`¡Hola${me ? `, ${me.profile.displayName.split(" ")[0]}` : ""}!`} subtitle="Cuéntanos un poco para personalizar Por aquí. Todo es opcional y puedes cambiarlo después." />
      <div className="grid max-w-2xl gap-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Idioma">{(c) => <Select {...c} value={locale} onChange={(e) => setLocale(e.target.value)}><option value="es">Español</option><option value="en">English</option></Select>}</Field>
          <Field label="Zona horaria" hint="Para interpretar bien las horas de tus visitas.">{(c) => <Select {...c} value={timezone} onChange={(e) => setTimezone(e.target.value)}>{zones().map((z) => <option key={z} value={z}>{z}</option>)}</Select>}</Field>
        </div>
        <fieldset>
          <legend className="mb-2 font-semibold">¿Qué te gusta descubrir?</legend>
          <div className="flex flex-wrap gap-2">
            {interests.data?.map((i) => {
              const on = chosen.includes(i.slug);
              return <button key={i.slug} type="button" aria-pressed={on} onClick={() => setChosen(on ? chosen.filter((x) => x !== i.slug) : [...chosen, i.slug])} className={cn("min-h-10 rounded-full border px-4 text-sm font-medium", on ? "border-primary bg-sage text-sage-foreground" : "border-control-border bg-surface")}>{on ? "✓ " : "+ "}{i.label}</button>;
            })}
          </div>
        </fieldset>
        <div className="flex items-center gap-4">
          <Avatar name={me?.profile.displayName ?? "?"} src={me?.profile.avatarUrl} size={64} />
          <div>
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" id="avatar" aria-label="Elegir foto de perfil" tabIndex={-1} onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadAvatar(f); e.target.value = ""; }} />
            <Button variant="outline" size="sm" loading={avatarState === "uploading" || avatarState === "processing"} onClick={() => fileRef.current?.click()}>Elegir foto de perfil (opcional)</Button>
            <p role="status" className="mt-1 text-sm text-muted-foreground">{avatarState === "processing" ? "Procesando imagen…" : avatarState === "ready" ? "Foto de perfil actualizada." : ""}</p>
            {avatarState === "error" ? <p role="alert" className="mt-1 text-sm text-danger">{avatarMsg}</p> : null}
          </div>
        </div>
        {save.isError ? <Alert tone="danger" live="assertive">{errorMessage(save.error)}</Alert> : null}
        <div className="flex flex-wrap gap-3">
          <Button loading={save.isPending && !save.variables} onClick={() => save.mutate(false)}>Guardar y continuar</Button>
          <Button variant="ghost" loading={save.isPending && save.variables === true} onClick={() => save.mutate(true)}>Omitir por ahora</Button>
        </div>
      </div>
    </>
  );
}
