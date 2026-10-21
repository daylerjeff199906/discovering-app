import { Outlet } from "react-router";
import { SiteShell } from "../components/shell";

export default function LayoutSite() {
  return (
    <SiteShell>
      <Outlet />
    </SiteShell>
  );
}
