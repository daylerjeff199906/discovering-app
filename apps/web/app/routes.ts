import { index, layout, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  // Públicas con SSR
  layout("routes/layout-site.tsx", [
    index("routes/home.tsx"),
    route("explorar", "routes/explorar.tsx"),
    route("r/:slug", "routes/ruta-publica.tsx"),
    route("s/:token", "routes/ruta-compartida.tsx"),
    route("u/:username", "routes/perfil-publico.tsx"),
    route("terminos", "routes/terminos.tsx"),
  ]),

  // Cuenta
  layout("routes/layout-auth.tsx", [
    route("registro", "routes/registro.tsx"),
    route("ingresar", "routes/ingresar.tsx"),
    route("verificar-correo", "routes/verificar-correo.tsx"),
    route("recuperar-cuenta", "routes/recuperar-cuenta.tsx"),
    route("restablecer-clave", "routes/restablecer-clave.tsx"),
  ]),

  // Privadas: shell en servidor, datos en cliente
  layout("routes/layout-app.tsx", [
    route("bienvenida", "routes/bienvenida.tsx"),
    route("app", "routes/app.inicio-redirect.tsx"),
    route("app/inicio", "routes/app.inicio.tsx"),
    route("app/catalogo", "routes/app.catalogo.tsx"),
    route("app/viajes", "routes/app.viajes.tsx"),
    route("app/guardados", "routes/app.guardados.tsx"),
    route("app/viajes/nuevo", "routes/app.viajes.nuevo.tsx"),
    route("app/viajes/importar", "routes/app.viajes.importar.tsx"),
    route("app/viajes/:id/editar", "routes/app.viajes.$id.editar.tsx"),
    route("app/viajes/:id", "routes/app.viajes.$id.tsx"),
    route("app/viajes/:id/recorrido", "routes/app.viajes.$id.recorrido.tsx"),
    route("app/viajes/:id/visitas/nueva", "routes/app.viajes.$id.visitas.nueva.tsx"),
    route("app/viajes/:id/visitas/:visitId", "routes/app.viajes.$id.visitas.$visitId.tsx"),
    route("app/viajes/:id/compartir", "routes/app.viajes.$id.compartir.tsx"),
    route("app/perfil", "routes/app.perfil.tsx"),
    route("app/cuenta", "routes/app.cuenta.tsx"),
    route("moderacion", "routes/moderacion.tsx"),
  ]),

  route("*", "routes/no-encontrada.tsx"),
] satisfies RouteConfig;
