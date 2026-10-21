import type { PublicRouteCard } from "@por-aqui/contracts";
import { Avatar, Badge } from "@por-aqui/ui";
import { Link } from "react-router";
import { formatDate } from "../lib/format";

export function RouteCard({ route, interestLabels }: { route: PublicRouteCard; interestLabels?: Record<string, string> }) {
  return (
    <article className="group flex flex-col overflow-hidden rounded-card border border-border bg-surface shadow-card transition-shadow duration-150 hover:shadow-md">
      {/* El título ya enlaza a la historia: este enlace de la imagen es redundante para teclado y lectores de pantalla. */}
      <Link to={`/r/${route.slug}`} className="block no-underline" aria-hidden="true" tabIndex={-1}>
        {route.coverThumbUrl ? (
          <img src={route.coverThumbUrl} alt="" loading="lazy" decoding="async" width={480} height={360} className="aspect-[4/3] w-full object-cover" />
        ) : (
          <div className="flex aspect-[4/3] w-full items-center justify-center bg-sage text-sage-foreground" aria-hidden="true">
            <svg viewBox="0 0 120 80" className="w-1/2" fill="none">
              <circle cx="20" cy="62" r="9" fill="currentColor" />
              <circle cx="100" cy="18" r="9" stroke="currentColor" strokeWidth="5" />
              <path d="M20 53C20 20 100 50 100 28" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray="1 11" />
            </svg>
          </div>
        )}
      </Link>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex flex-wrap items-center gap-2">
          {route.isDemo ? <Badge tone="warning">Demostración</Badge> : null}
          {route.durationDays ? <Badge tone="sage">{route.durationDays} {route.durationDays === 1 ? "día" : "días"}</Badge> : null}
          {route.transportSummary ? <Badge>{route.transportSummary}</Badge> : null}
        </div>
        <h3 className="text-xl">
          <Link to={`/r/${route.slug}`} className="text-foreground no-underline hover:underline">
            {route.title}
          </Link>
        </h3>
        {route.locationLabel ? <p className="text-sm text-muted-foreground">{route.locationLabel} · {route.stopsCount} paradas</p> : null}
        {route.description ? <p className="line-clamp-2 text-[0.95rem]">{route.description}</p> : null}
        {route.interests.length ? (
          <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
            {route.interests.slice(0, 4).map((i) => (
              <li key={i} className="rounded-full bg-surface-muted px-2 py-0.5 text-xs">{interestLabels?.[i] ?? i}</li>
            ))}
          </ul>
        ) : null}
        <div className="mt-auto flex items-center gap-2 pt-2 text-sm text-muted-foreground">
          <Avatar name={route.author.displayName} src={route.author.avatarUrl} size={28} />
          <Link to={`/u/${route.author.username}`} className="font-semibold text-foreground no-underline hover:underline">{route.author.displayName}</Link>
          {route.publishedAt ? <span>· {formatDate(route.publishedAt)}</span> : null}
        </div>
      </div>
    </article>
  );
}
