import { Body, Controller, Get, Inject, Injectable, Patch } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { updateProfileInputSchema, type MeDto, type UpdateProfileInput } from "@por-aqui/contracts";
import { interests, profiles, type Db } from "@por-aqui/database";
import { eq, inArray } from "drizzle-orm";
import { Api, type AuthUser, CurrentUser } from "../../common/decorators";
import { badRequest, conflict } from "../../common/errors";
import { DB } from "../../infrastructure/tokens";
import { AuthService } from "../auth/auth.service";

@Injectable()
export class UsersService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly auth: AuthService,
  ) {}

  async updateProfile(user: AuthUser, input: UpdateProfileInput): Promise<MeDto> {
    const patch: Partial<typeof profiles.$inferInsert> = {};
    if (input.displayName !== undefined) patch.displayName = input.displayName;
    if (input.bio !== undefined) patch.bio = input.bio === "" ? null : input.bio;
    if (input.locale !== undefined) patch.locale = input.locale;
    if (input.timezone !== undefined) patch.timezone = input.timezone;
    if (input.username !== undefined) {
      patch.username = input.username;
      patch.usernameNormalized = input.username.toLowerCase();
    }
    if (input.interests !== undefined) {
      const known = input.interests.length ? await this.db.select({ slug: interests.slug }).from(interests).where(inArray(interests.slug, input.interests)) : [];
      if (known.length !== new Set(input.interests).size) throw badRequest("VALIDATION_ERROR", "Hay intereses desconocidos.", { interests: ["Interés desconocido"] });
      patch.preferencesJson = { interests: [...new Set(input.interests)] };
    }
    if (input.completeOnboarding) patch.onboardingCompletedAt = new Date();
    if (Object.keys(patch).length > 0) {
      try {
        await this.db.update(profiles).set(patch).where(eq(profiles.userId, user.id));
      } catch (err) {
        if (JSON.stringify(err, Object.getOwnPropertyNames(err)).includes("profiles_username_normalized_unique")) throw conflict("USERNAME_TAKEN", "Ese nombre de usuario ya está en uso.", { field: "username" });
        throw err;
      }
    }
    return this.auth.me(user.id);
  }
}

@ApiTags("me")
@Controller("me")
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly auth: AuthService,
  ) {}

  @Get("profile")
  @Api({ summary: "Mi perfil" })
  profile(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @Patch("profile")
  @Api({ summary: "Actualizar perfil / completar onboarding", body: updateProfileInputSchema })
  update(@CurrentUser() user: AuthUser, @Body() body: UpdateProfileInput) {
    return this.users.updateProfile(user, body);
  }
}
