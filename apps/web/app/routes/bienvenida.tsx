import { safeReturnTo } from "@por-aqui/contracts";
import { uploadToStorage } from "@por-aqui/api-client";
import { Alert, Avatar, Button, Field, Select } from "@por-aqui/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import {
  ArrowLeft,
  ArrowRight,
  Bird,
  Building2,
  Camera,
  Check,
  Compass,
  Globe2,
  Landmark,
  MapPin,
  MoonStar,
  Palette,
  Store,
  Sun,
  Trees,
  Utensils,
} from "lucide-react";
import { AmazonArt } from "../components/travel-art";
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
    return (
      Intl as unknown as { supportedValuesOf: (k: string) => string[] }
    ).supportedValuesOf("timeZone");
  } catch {
    return [
      "America/Lima",
      "America/Bogota",
      "America/Mexico_City",
      "Europe/Madrid",
      "UTC",
    ];
  }
};

const interestIcons: Record<string, typeof Compass> = {
  arquitectura: Building2,
  aventura: Compass,
  cultura: Palette,
  fauna: Bird,
  fotografia: Camera,
  gastronomia: Utensils,
  historia: Landmark,
  mercados: Store,
  museos: Landmark,
  naturaleza: Trees,
  relax: Sun,
  "vida-nocturna": MoonStar,
};
const steps = ["Lo que te mueve", "Tu hora y tu idioma", "Dale tu toque"];

/** Onboarding breve y omisible. No pide ubicación precisa. */
export default function Bienvenida() {
  const { me } = useMe();
  const [params] = useSearchParams();
  const returnTo = safeReturnTo(params.get("returnTo"), "/app/inicio");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const stepMounted = useRef(false);
  useEffect(() => {
    if (!stepMounted.current) {
      stepMounted.current = true;
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
    headingRef.current?.scrollIntoView({ behavior: "auto", block: "start" });
  }, [step]);
  const interests = useQuery(interestsQuery());
  const [locale, setLocale] = useState(me?.profile.locale ?? "es");
  const [timezone, setTimezone] = useState(
    me?.profile.timezone && me.profile.timezone !== "America/Lima"
      ? me.profile.timezone
      : browserTimezone(),
  );
  const [chosen, setChosen] = useState<string[]>(me?.profile.interests ?? []);
  const [avatarState, setAvatarState] = useState<
    "idle" | "uploading" | "processing" | "ready" | "error"
  >("idle");
  const [avatarMsg, setAvatarMsg] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const save = useMutation({
    mutationFn: (skip: boolean) =>
      api.me.updateProfile(
        skip
          ? { completeOnboarding: true }
          : { locale, timezone, interests: chosen, completeOnboarding: true },
      ),
    onSuccess: (m) => {
      qc.setQueryData(qk.me, m);
      navigate(returnTo, { replace: true });
    },
  });

  const uploadAvatar = async (file: File) => {
    setAvatarState("uploading");
    setAvatarMsg("");
    try {
      const auth = await api.me.avatarUpload({
        mimeType: file.type as "image/jpeg",
        sizeBytes: file.size,
      });
      await uploadToStorage(auth, file);
      let asset = await api.media.complete(auth.assetId);
      setAvatarState("processing");
      for (
        let i = 0;
        i < 20 && asset.status !== "READY" && asset.status !== "FAILED";
        i++
      ) {
        await new Promise((r) => setTimeout(r, 800));
        asset = await api.media.status(auth.assetId);
      }
      if (asset.status === "READY") {
        await qc.invalidateQueries({ queryKey: qk.me });
        setAvatarState("ready");
      } else {
        setAvatarState("error");
        setAvatarMsg(
          asset.status === "FAILED"
            ? "No pudimos procesar esa imagen. Prueba con otra (JPEG, PNG o WebP)."
            : "Tarda más de lo normal. Puedes seguir y revisarlo luego en tu perfil.",
        );
      }
    } catch (e) {
      setAvatarState("error");
      setAvatarMsg(errorMessage(e, "No pudimos subir la imagen."));
    }
  };

  const nextStep = () => {
    setStep((s) => Math.min(2, s + 1));
  };
  const busy =
    save.isPending ||
    avatarState === "uploading" ||
    avatarState === "processing";
  return (
    <div className="onboarding-layout">
      <aside className="onboarding-aside">
        <p className="eyebrow">Un viaje muy tuyo</p>
        <h2>
          Iquitos tiene mil historias.
          <br />
          <em>Vive la tuya.</em>
        </h2>
        <p>
          Unas pequeñas pistas para acompañarte a descubrir lo que más te gusta.
        </p>
        <ol aria-label="Pasos de bienvenida">
          {steps.map((label, i) => (
            <li
              key={label}
              data-active={i === step}
              data-complete={i < step}
              aria-current={i === step ? "step" : undefined}
            >
              <span>
                {i < step ? (
                  <Check size={13} aria-hidden="true" />
                ) : (
                  `0${i + 1}`
                )}
              </span>
              {label}
            </li>
          ))}
        </ol>
        <AmazonArt />
      </aside>
      <section className="onboarding-main" aria-labelledby="onboarding-title">
        <div className="onboarding-topline">
          <div
            className="step-bars"
            role="img"
            aria-label={`Paso ${step + 1} de 3`}
          >
            {steps.map((_, i) => (
              <span key={i} data-on={i <= step} />
            ))}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => save.mutate(true)}
          >
            Lo haré después
          </button>
        </div>
        <p className="eyebrow mb-3">
          0{step + 1} / 03 · {steps[step]}
        </p>
        <h1
          id="onboarding-title"
          ref={headingRef}
          tabIndex={-1}
          className="outline-none"
        >
          {step === 0
            ? `¿Qué te gusta descubrir${me ? `, ${me.profile.displayName.split(" ")[0]}` : ""}?`
            : step === 1
              ? "Cada aventura tiene su lugar."
              : "Ponle cara a tus historias."}
        </h1>
        <p className="onboarding-description">
          {step === 0
            ? "Elige lo que despierta tu curiosidad. Puedes marcar varios intereses y cambiarlos cuando quieras."
            : step === 1
              ? "Ajusta tu idioma y zona horaria para que cada recuerdo quede en su momento."
              : "Una foto para que la comunidad te reconozca. Este paso también es opcional."}
        </p>
        {step === 0 ? (
          <>
            {interests.isPending ? (
              <p
                role="status"
                className="py-10 text-center text-sm text-muted-foreground"
              >
                Preparando tus intereses…
              </p>
            ) : null}
            {interests.isError ? (
              <Alert tone="warning">
                No pudimos cargar los intereses.{" "}
                <button
                  type="button"
                  className="underline"
                  onClick={() => void interests.refetch()}
                >
                  Volver a intentar
                </button>{" "}
                o continúa para elegirlos después.
              </Alert>
            ) : null}
            <div
              className="interest-grid"
              role="group"
              aria-label="Tus intereses"
            >
              {interests.data?.map((i) => {
                const on = chosen.includes(i.slug);
                const Icon = interestIcons[i.slug] ?? Compass;
                return (
                  <button
                    key={i.slug}
                    type="button"
                    aria-pressed={on}
                    onClick={() =>
                      setChosen(
                        on
                          ? chosen.filter((x) => x !== i.slug)
                          : [...chosen, i.slug],
                      )
                    }
                    className="interest-option"
                  >
                    <Icon size={25} strokeWidth={1.3} aria-hidden="true" />
                    <span>{i.label}</span>
                    {on ? (
                      <Check
                        className="interest-check"
                        size={14}
                        aria-hidden="true"
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
            <p className="onboarding-selection-note" aria-live="polite">
              {chosen.length
                ? `${chosen.length} ${chosen.length === 1 ? "interés seleccionado" : "intereses seleccionados"}. Esto ya se parece más a ti.`
                : "No hay respuestas correctas. Solo lo que te hace querer salir."}
            </p>
          </>
        ) : null}
        {step === 1 ? (
          <div className="onboarding-settings">
            <Field
              label={
                <span className="flex items-center gap-2">
                  <Globe2 size={15} aria-hidden="true" /> Tu idioma
                </span>
              }
            >
              {(c) => (
                <Select
                  {...c}
                  value={locale}
                  onChange={(e) => setLocale(e.target.value)}
                >
                  <option value="es">Español</option>
                  <option value="en">English</option>
                </Select>
              )}
            </Field>
            <Field
              label={
                <span className="flex items-center gap-2">
                  <MapPin size={15} aria-hidden="true" /> Zona horaria
                </span>
              }
              hint="La usaremos para las fechas y horas de tus visitas."
            >
              {(c) => (
                <Select
                  {...c}
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                >
                  {Array.from(new Set([timezone, ...zones()])).map((z) => (
                    <option key={z} value={z}>
                      {z.replaceAll("_", " ")}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <p>
              No necesitamos tu ubicación precisa. Tú decides cuándo usar el GPS
              durante un recorrido.
            </p>
          </div>
        ) : null}
        {step === 2 ? (
          <div className="onboarding-avatar">
            <Avatar
              name={me?.profile.displayName ?? "?"}
              src={me?.profile.avatarUrl}
              size={88}
            />
            <div className="text-center">
              <p className="font-serif text-xl">
                {me?.profile.displayName ?? "Tu próxima aventura"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Próximamente, muchas historias por contar.
              </p>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              id="avatar"
              aria-label="Elegir foto de perfil"
              tabIndex={-1}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadAvatar(f);
                e.target.value = "";
              }}
            />
            <Button
              variant="outline"
              size="sm"
              loading={
                avatarState === "uploading" || avatarState === "processing"
              }
              onClick={() => fileRef.current?.click()}
            >
              <Camera size={16} aria-hidden="true" /> Elegir una foto
            </Button>
            <p role="status">
              {avatarState === "processing"
                ? "Procesando imagen…"
                : avatarState === "ready"
                  ? "Tu foto quedó lista."
                  : "JPEG, PNG o WebP"}
            </p>
            {avatarState === "error" ? (
              <p role="alert" className="text-sm text-danger">
                {avatarMsg}
              </p>
            ) : null}
          </div>
        ) : null}
        {save.isError ? (
          <Alert tone="danger" live="assertive" className="mt-4">
            {errorMessage(save.error)}
          </Alert>
        ) : null}
        <div className="onboarding-actions">
          {step > 0 ? (
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setStep(step - 1)}
            >
              <ArrowLeft size={16} aria-hidden="true" /> Atrás
            </Button>
          ) : (
            <span className="text-[10px] text-muted-foreground">
              Todo es opcional.
            </span>
          )}
          {step < 2 ? (
            <Button disabled={busy} onClick={nextStep}>
              Continuar <ArrowRight size={16} aria-hidden="true" />
            </Button>
          ) : (
            <Button
              loading={save.isPending}
              disabled={busy && !save.isPending}
              onClick={() => save.mutate(false)}
            >
              Empezar a explorar <ArrowRight size={16} aria-hidden="true" />
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
