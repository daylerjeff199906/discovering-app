import { Controller, Delete, Get, HttpCode, Param, Post, Put, Query, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  changePasswordInputSchema,
  deleteAccountInputSchema,
  forgotPasswordInputSchema,
  loginInputSchema,
  registerInputSchema,
  resendVerificationInputSchema,
  resetPasswordInputSchema,
  tokenInputSchema,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
} from "@por-aqui/contracts";
import type { Request, Response } from "express";
import { Api, type AuthUser, CurrentUser, OptionalUser, Public, RateLimit } from "../../common/decorators";
import { AuthService } from "./auth.service";
import { Body } from "@nestjs/common";
import { z } from "zod";

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get("csrf")
  @Api({ summary: "Entrega el token CSRF (doble-submit) y fija su cookie" })
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.csrf(req, res);
  }

  @Public()
  @Post("register")
  @RateLimit({ key: "register", limit: 10, windowSec: 3600 })
  @Api({ summary: "Crear cuenta (pendiente de verificación)", body: registerInputSchema, status: 201 })
  register(@Body() body: RegisterInput) {
    return this.auth.register(body);
  }

  @Public()
  @Get("google/start")
  @RateLimit({ key: "google", limit: 30, windowSec: 600 })
  @Api({ summary: "Inicia sesión o crea cuenta con Google (redirige a Google; PKCE + state + nonce)" })
  googleStart(@Query() query: { mode?: string; terms?: string; returnTo?: string }, @Res() res: Response) {
    res.redirect(302, this.auth.googleStart(query, res));
  }

  @Public()
  @Get("google/callback")
  @RateLimit({ key: "google", limit: 30, windowSec: 600 })
  @Api({ summary: "Retorno de Google: valida, vincula o crea la cuenta, abre sesión y redirige a la web" })
  async googleCallback(@Query() query: { code?: string; state?: string; error?: string }, @Req() req: Request, @Res() res: Response) {
    res.redirect(302, await this.auth.googleCallback(query, req, res));
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  @RateLimit({ key: "login", limit: 20, windowSec: 300, byEmail: true })
  @Api({ summary: "Iniciar sesión (cookie HttpOnly)", body: loginInputSchema })
  login(@Body() body: LoginInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.login(body, req, res);
  }

  @Public()
  @Post("logout")
  @HttpCode(200)
  @Api({ summary: "Cerrar sesión" })
  logout(@OptionalUser() user: AuthUser | undefined, @Res({ passthrough: true }) res: Response) {
    return this.auth.logout(user, res);
  }

  @Get("me")
  @Api({ summary: "Usuario actual" })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @Public()
  @Post("verify-email")
  @HttpCode(200)
  @RateLimit({ key: "verify", limit: 20, windowSec: 600 })
  @Api({ summary: "Confirmar el correo (acción explícita, no GET)", body: tokenInputSchema })
  verifyEmail(@Body() body: z.infer<typeof tokenInputSchema>) {
    return this.auth.verifyEmail(body.token);
  }

  @Public()
  @Post("resend-verification")
  @HttpCode(200)
  @RateLimit({ key: "resend", limit: 10, windowSec: 3600 })
  @Api({ summary: "Reenviar el correo de verificación (cooldown 60 s)", body: resendVerificationInputSchema })
  resend(@Body() body: z.infer<typeof resendVerificationInputSchema>, @OptionalUser() user: AuthUser | undefined) {
    return this.auth.resendVerification(user, body.email);
  }

  @Public()
  @Post("forgot-password")
  @HttpCode(200)
  @RateLimit({ key: "forgot", limit: 10, windowSec: 3600, byEmail: true })
  @Api({ summary: "Solicitar recuperación (respuesta genérica)", body: forgotPasswordInputSchema })
  forgot(@Body() body: z.infer<typeof forgotPasswordInputSchema>) {
    return this.auth.forgotPassword(body.email);
  }

  @Public()
  @Post("reset-password")
  @HttpCode(200)
  @RateLimit({ key: "reset", limit: 10, windowSec: 3600 })
  @Api({ summary: "Establecer nueva contraseña (revoca todas las sesiones)", body: resetPasswordInputSchema })
  reset(@Body() body: ResetPasswordInput) {
    return this.auth.resetPassword(body);
  }

  @Get("sessions")
  @Api({ summary: "Sesiones activas del usuario" })
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.listSessions(user);
  }

  @Delete("sessions")
  @Api({ summary: "Revocar las demás sesiones" })
  revokeOthers(@CurrentUser() user: AuthUser) {
    return this.auth.revokeOtherSessions(user);
  }

  @Delete("sessions/:id")
  @Api({ summary: "Revocar una sesión propia" })
  revoke(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.auth.revokeSession(user, id);
  }
}

@ApiTags("me")
@Controller("me")
export class AccountController {
  constructor(private readonly auth: AuthService) {}

  @Put("password")
  @Api({ summary: "Cambiar contraseña (revoca las demás sesiones y rota la actual)", body: changePasswordInputSchema })
  changePassword(@CurrentUser() user: AuthUser, @Body() body: ChangePasswordInput, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.auth.changePassword(user, body, req, res);
  }

  @Delete("account")
  @Api({ summary: "Eliminar cuenta (purga asíncrona)", body: deleteAccountInputSchema })
  deleteAccount(@CurrentUser() user: AuthUser, @Body() body: z.infer<typeof deleteAccountInputSchema>, @Res({ passthrough: true }) res: Response) {
    return this.auth.deleteAccount(user, body.password, res);
  }
}
