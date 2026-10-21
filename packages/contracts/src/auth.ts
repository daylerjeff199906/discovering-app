import { z } from "zod";
import { timezoneSchema, uuidSchema } from "./common";

export const PASSWORD_RULES = [
  { id: "length", label: "Al menos 10 caracteres", test: (v: string) => v.length >= 10 },
  { id: "letter", label: "Una letra", test: (v: string) => /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(v) },
  { id: "digit", label: "Un número", test: (v: string) => /\d/.test(v) },
] as const;

export const passwordSchema = z
  .string()
  .min(10, "Mínimo 10 caracteres")
  .max(128, "Máximo 128 caracteres")
  .regex(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/, "Debe incluir una letra")
  .regex(/\d/, "Debe incluir un número");

export const usernameSchema = z
  .string()
  .regex(/^[A-Za-z0-9_]{3,24}$/, "3–24 caracteres: letras, números y guion bajo");

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email("Correo inválido"));
export const displayNameSchema = z.string().trim().min(1, "Requerido").max(60);

export const registerInputSchema = z
  .object({
    displayName: displayNameSchema,
    username: usernameSchema,
    email: emailSchema,
    password: passwordSchema,
    passwordConfirm: z.string(),
    acceptTerms: z.literal(true, { error: "Debes aceptar los términos" }),
    termsVersion: z.string().max(40),
  })
  .refine((v) => v.password === v.passwordConfirm, { path: ["passwordConfirm"], message: "Las contraseñas no coinciden" });
export type RegisterInput = z.infer<typeof registerInputSchema>;

export const loginInputSchema = z.object({ email: emailSchema, password: z.string().min(1).max(128) });
export type LoginInput = z.infer<typeof loginInputSchema>;

export const tokenInputSchema = z.object({ token: z.string().min(20).max(200) });
export const resendVerificationInputSchema = z.object({ email: emailSchema.optional() });
export const forgotPasswordInputSchema = z.object({ email: emailSchema });

export const resetPasswordInputSchema = z
  .object({ token: z.string().min(20).max(200), password: passwordSchema, passwordConfirm: z.string() })
  .refine((v) => v.password === v.passwordConfirm, { path: ["passwordConfirm"], message: "Las contraseñas no coinciden" });
export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>;

export const changePasswordInputSchema = z
  .object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema, newPasswordConfirm: z.string() })
  .refine((v) => v.newPassword === v.newPasswordConfirm, { path: ["newPasswordConfirm"], message: "Las contraseñas no coinciden" });
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>;

export const deleteAccountInputSchema = z.object({ password: z.string().min(1).max(128), confirmation: z.literal("ELIMINAR") });

export const USER_ROLES = ["USER", "MODERATOR"] as const;

export const profileDtoSchema = z.object({
  username: z.string(),
  displayName: z.string(),
  bio: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  locale: z.string(),
  timezone: z.string(),
  interests: z.array(z.string()),
  onboardingCompleted: z.boolean(),
});
export type ProfileDto = z.infer<typeof profileDtoSchema>;

export const meDtoSchema = z.object({
  id: uuidSchema,
  email: z.string(),
  emailVerified: z.boolean(),
  role: z.enum(USER_ROLES),
  accountStatus: z.enum(["ACTIVE", "DISABLED", "DELETION_PENDING"]),
  profile: profileDtoSchema,
});
export type MeDto = z.infer<typeof meDtoSchema>;

export const updateProfileInputSchema = z.object({
  displayName: displayNameSchema.optional(),
  username: usernameSchema.optional(),
  bio: z.string().trim().max(280).nullable().optional(),
  locale: z.string().min(2).max(16).optional(),
  timezone: timezoneSchema.optional(),
  interests: z.array(z.string().max(40)).max(20).optional(),
  completeOnboarding: z.boolean().optional(),
});
export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>;

export const sessionDtoSchema = z.object({
  id: uuidSchema,
  createdAt: z.string(),
  lastSeenAt: z.string(),
  expiresAt: z.string(),
  userAgentLabel: z.string().nullable(),
  current: z.boolean(),
});
export type SessionDto = z.infer<typeof sessionDtoSchema>;

export const interestDtoSchema = z.object({ slug: z.string(), label: z.string() });
export type InterestDto = z.infer<typeof interestDtoSchema>;

/** Rutas internas permitidas como `returnTo` tras autenticarse. */
export function safeReturnTo(value: string | null | undefined, fallback = "/app/viajes"): string {
  if (!value) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  if (/^\/(app|r|s|u|explorar|bienvenida)(\/|\?|#|$)/.test(value) || value === "/") return value;
  return fallback;
}
