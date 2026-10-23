import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Resend } from "resend";
import { findRepoRoot, type Env } from "../../config/env";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export abstract class MailerPort {
  abstract send(message: MailMessage): Promise<void>;
}

/** Envío real con Resend. Un error de Resend se propaga para que el evento del outbox se reintente. */
export class ResendMailer extends MailerPort {
  private readonly client: Resend;
  constructor(private readonly env: Env) {
    super();
    this.client = new Resend(env.RESEND_API_KEY);
  }
  async send(message: MailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: this.env.MAIL_FROM,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      ...(this.env.MAIL_REPLY_TO ? { replyTo: this.env.MAIL_REPLY_TO } : {}),
    });
    if (error) throw new Error(`RESEND_${error.name}: ${error.message}`);
  }
}

/** Solo desarrollo, sin RESEND_API_KEY: deja cada correo como archivo de texto (con el enlace) en DEV_MAIL_DIR. */
export class DevMailer extends MailerPort {
  constructor(private readonly env: Env) {
    super();
  }
  async send(message: MailMessage): Promise<void> {
    const dir = path.resolve(findRepoRoot(), this.env.DEV_MAIL_DIR);
    await mkdir(dir, { recursive: true });
    const safeTo = message.to.replace(/[^a-z0-9@._-]/gi, "_");
    const file = path.join(dir, `${Date.now()}-${safeTo}.txt`);
    await writeFile(file, `To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n`, "utf8");
    console.log(JSON.stringify({ level: "info", msg: "correo de desarrollo (sin RESEND_API_KEY)", to: message.to, subject: message.subject, file }));
  }
}

export function createMailer(env: Env): MailerPort {
  return env.RESEND_API_KEY ? new ResendMailer(env) : new DevMailer(env);
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
