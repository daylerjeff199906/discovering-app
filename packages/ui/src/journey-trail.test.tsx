import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { JourneyTrail, type TrailItem } from "./journey-trail";

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

const items = (n: number, states: TrailItem["state"][] = []): TrailItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i}`, title: `Parada ${i + 1}`, state: states[i] ?? "pending" }));

describe("JourneyTrail", () => {
  it("es una lista ordenada semántica con etiqueta accesible", () => {
    render(<JourneyTrail items={items(3)} ariaLabel="Paradas del día 1" />);
    const list = screen.getByRole("list", { name: "Paradas del día 1" });
    expect(list.tagName).toBe("OL");
    expect(within(list).getAllByRole("listitem")).toHaveLength(3);
  });

  it("los estados no dependen solo del color: llevan texto", () => {
    render(<JourneyTrail items={items(3, ["visited", "current", "pending"])} />);
    expect(screen.getAllByText(/Visitado/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Aquí ahora/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Pendiente/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("listitem").find((li) => li.getAttribute("aria-current") === "step")).toBeTruthy();
  });

  it("la línea SVG es decorativa: aria-hidden y sin capturar clics", () => {
    const { container } = render(<JourneyTrail items={items(2)} />);
    const svg = container.querySelector("svg")!;
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg.getAttribute("class")).toContain("pointer-events-none");
  });

  it("no falla al pasar de más a menos ítems (regresión: puntos medidos obsoletos)", () => {
    const { rerender } = render(<JourneyTrail items={items(4)} />);
    expect(() => rerender(<JourneyTrail items={items(2)} />)).not.toThrow();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(() => rerender(<JourneyTrail items={[]} />)).not.toThrow();
  });

  it("muestra acciones, conector y permite seleccionar", () => {
    const onSelect = vi.fn();
    const base = items(2);
    render(<JourneyTrail items={[{ ...base[0]!, actions: <button type="button">Quitar</button>, connector: "A pie · Por definir" }, base[1]!]} onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: "Quitar" })).toBeInTheDocument();
    expect(screen.getByLabelText("Traslado al siguiente punto")).toHaveTextContent("Por definir");
    screen.getByRole("button", { name: "Parada 1" }).click();
    expect(onSelect).toHaveBeenCalledWith("s0");
  });
});
