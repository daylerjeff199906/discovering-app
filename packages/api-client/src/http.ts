import type { ApiErrorBody } from "@por-aqui/contracts";

/** Error devuelto por la API con código estable, errores por campo y requestId. */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors?: Record<string, string[]>;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(status: number, body: Partial<ApiErrorBody>) {
    super(body.message ?? "Algo salió mal.");
    this.name = "ApiError";
    this.status = status;
    this.code = body.code ?? "HTTP_ERROR";
    this.fieldErrors = body.fieldErrors;
    this.details = body.details;
    this.requestId = body.requestId;
  }

  get isConflict() {
    return this.status === 409 && this.code === "VERSION_CONFLICT";
  }
}

/** No hubo respuesta: sin conexión, DNS, CORS o servidor caído. Es el caso en que se encola en local. */
export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super("No hay conexión con el servidor.");
    this.name = "NetworkError";
    this.cause = cause;
  }
}

export interface ClientOptions {
  /** Vacío en el navegador (mismo origen); URL interna al renderizar en servidor. */
  baseUrl?: string;
  csrfCookieName?: string;
  fetchImpl?: typeof fetch;
  /** Cabeceras extra por petición (p. ej. reenviar cookie en SSR a NUESTRA API). */
  headers?: () => Record<string, string>;
}

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** Cuerpo multipart (subida de archivos). El navegador fija el Content-Type con su boundary. */
  form?: FormData;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class HttpClient {
  private readonly base: string;
  private readonly cookieName: string;
  private readonly fetchImpl: typeof fetch;
  private readonly extraHeaders?: () => Record<string, string>;
  private csrfInflight?: Promise<string | null>;

  constructor(opts: ClientOptions = {}) {
    this.base = (opts.baseUrl ?? "").replace(/\/$/, "");
    this.cookieName = opts.csrfCookieName ?? "pa_csrf";
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.extraHeaders = opts.headers;
  }

  private readCsrfCookie(): string | null {
    if (typeof document === "undefined") return null;
    const m = document.cookie.split("; ").find((c) => c.startsWith(`${this.cookieName}=`));
    return m ? decodeURIComponent(m.slice(this.cookieName.length + 1)) : null;
  }

  /** El token se lee de la cookie en cada mutación: el servidor lo rota al iniciar sesión. */
  async csrfToken(): Promise<string | null> {
    const existing = this.readCsrfCookie();
    if (existing) return existing;
    this.csrfInflight ??= this.fetchImpl(`${this.base}/api/v1/auth/csrf`, { credentials: "include" })
      .then(async (r) => (r.ok ? ((await r.json()) as { csrfToken: string }).csrfToken : null))
      .catch(() => null)
      .finally(() => {
        this.csrfInflight = undefined;
      });
    return (await this.csrfInflight) ?? this.readCsrfCookie();
  }

  async request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
    const url = new URL(`${this.base}/api/v1${path}`, typeof window !== "undefined" ? window.location.origin : "http://internal.invalid");
    for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));

    const headers: Record<string, string> = { Accept: "application/json", ...(this.extraHeaders?.() ?? {}), ...(opts.headers ?? {}) };
    if (opts.body !== undefined && !opts.form) headers["Content-Type"] = "application/json";
    if (UNSAFE.has(method)) {
      const token = await this.csrfToken();
      if (token) headers["X-CSRF-Token"] = token;
    }

    let res: Response;
    try {
      res = await this.fetchImpl(this.base ? url.toString() : `${url.pathname}${url.search}`, {
        method,
        headers,
        body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
        credentials: "include",
        signal: opts.signal,
      });
    } catch (err) {
      if ((err as { name?: string })?.name === "AbortError") throw err;
      throw new NetworkError(err);
    }

    const text = await res.text();
    let json: unknown = undefined;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }
    if (!res.ok) throw new ApiError(res.status, (json as Partial<ApiErrorBody>) ?? { message: res.statusText });
    return json as T;
  }

  get = <T>(path: string, o?: RequestOptions) => this.request<T>("GET", path, o);
  post = <T>(path: string, body?: unknown, o?: RequestOptions) => this.request<T>("POST", path, { ...o, body: body ?? {} });
  postForm = <T>(path: string, form: FormData, o?: RequestOptions) => this.request<T>("POST", path, { ...o, form });
  put = <T>(path: string, body?: unknown, o?: RequestOptions) => this.request<T>("PUT", path, { ...o, body: body ?? {} });
  patch = <T>(path: string, body?: unknown, o?: RequestOptions) => this.request<T>("PATCH", path, { ...o, body: body ?? {} });
  delete = <T>(path: string, o?: RequestOptions) => this.request<T>("DELETE", path, o);
}
