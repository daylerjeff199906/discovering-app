import { createTransport, type Transporter } from "nodemailer";
import type { Env } from "../../config/env";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export abstract class MailerPort {
  abstract send(message: MailMessage): Promise<void>;
}

export class SmtpMailer extends MailerPort {
  private readonly transport: Transporter;
  constructor(private readonly env: Env) {
    super();
    this.transport = createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    });
  }
  async send(message: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.env.MAIL_FROM, ...message });
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function layout(title: string, body: string, ctaLabel: string, url: string): string {
  return `<!doctype html><html lang="es"><body style="margin:0;background:#F8F5EE;font-family:Inter,Arial,sans-serif;color:#18372A">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">
<p style="font-family:Georgia,serif;font-size:22px;margin:0 0 24px">Por aquí</p>
<h1 style="font-family:Georgia,serif;font-size:24px;margin:0 0 12px">${esc(title)}</h1>
<p style="font-size:16px;line-height:1.5;margin:0 0 24px">${body}</p>
<p><a href="${esc(url)}" style="display:inline-block;background:#194B35;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600">${esc(ctaLabel)}</a></p>
<p style="font-size:13px;color:#596359;margin-top:24px">Si el botón no funciona, copia este enlace:<br>${esc(url)}</p>
</div></body></html>`;
}

export function verifyEmailMessage(to: string, displayName: string, url: string): MailMessage {
  return {
    to,
    subject: "Confirma tu correo en Por aquí",
    text: `Hola ${displayName},\n\nConfirma tu correo para poder publicar tus recorridos:\n${url}\n\nEl enlace vence en 24 horas. Si no creaste una cuenta, ignora este mensaje.`,
    html: layout("Confirma tu correo", `Hola ${esc(displayName)}, confirma tu correo para poder publicar tus recorridos. El enlace vence en 24 horas.`, "Confirmar correo", url),
  };
}

export function resetPasswordMessage(to: string, displayName: string, url: string): MailMessage {
  return {
    to,
    subject: "Restablece tu contraseña de Por aquí",
    text: `Hola ${displayName},\n\nPuedes elegir una nueva contraseña aquí:\n${url}\n\nEl enlace vence en 1 hora. Si no lo pediste, ignora este mensaje: tu contraseña no cambiará.`,
    html: layout("Restablece tu contraseña", `Hola ${esc(displayName)}, puedes elegir una nueva contraseña. El enlace vence en 1 hora. Si no lo pediste, ignora este mensaje.`, "Elegir nueva contraseña", url),
  };
}

export function accountExistsMessage(to: string, loginUrl: string, resetUrl: string): MailMessage {
  return {
    to,
    subject: "Ya tienes una cuenta en Por aquí",
    text: `Alguien intentó crear una cuenta con este correo, pero ya existe una.\nInicia sesión: ${loginUrl}\n¿Olvidaste tu contraseña? ${resetUrl}\n\nSi no fuiste tú, puedes ignorar este mensaje.`,
    html: layout("Ya tienes una cuenta", "Alguien intentó crear una cuenta con este correo, pero ya existe una. Si no fuiste tú, ignora este mensaje.", "Iniciar sesión", loginUrl),
  };
}
