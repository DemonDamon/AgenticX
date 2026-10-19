import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/i18n";
import { SidebarSpaces } from "./SidebarSpaces";

vi.mock("../../store", () => ({
  useAppStore: (selector: (state: { openProject: (projectId: string | null) => void }) => unknown) =>
    selector({ openProject: () => undefined }),
}));

vi.mock("../../hooks/usePaneNavigation", () => ({
  usePaneNavigation: () => ({ newMetaTask: () => undefined }),
}));

const spaces = [
  { id: "s1", name: "导出", path: "/tmp/export", created_at: 1 },
  { id: "s2", name: "Claw", path: "/tmp/claw", created_at: 2 },
];

const projects = [{ id: "p1", name: "评标系统" }];

describe("SidebarSpaces", () => {
  beforeEach(async () => {
    await i18n.changeLanguage("zh");
  });

  it("renders the space count, local spaces, and a project when signed in", () => {
    const html = renderToStaticMarkup(
      <SidebarSpaces
        rowsBySpace={{}}
        onOpenSession={() => undefined}
        spaces={spaces}
        projects={projects}
        enterpriseLoggedIn
      />,
    );
    expect(html).toContain("空间（3）");
    expect(html).toContain("导出");
    expect(html).toContain("Claw");
    expect(html).toContain("评标系统");
  });

  it("omits project rows when the enterprise account is signed out", () => {
    const html = renderToStaticMarkup(
      <SidebarSpaces
        rowsBySpace={{}}
        onOpenSession={() => undefined}
        spaces={spaces}
        projects={projects}
        enterpriseLoggedIn={false}
      />,
    );
    expect(html).toContain("空间（2）");
    expect(html).toContain("导出");
    expect(html).toContain("Claw");
    expect(html).not.toContain("评标系统");
  });
});
