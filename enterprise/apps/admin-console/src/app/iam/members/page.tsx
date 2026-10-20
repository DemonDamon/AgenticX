"use client";

import { Suspense, useCallback, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  PageHeader,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@agenticx/ui";
import { useTranslations } from "next-intl";
import { Building2, Upload, UserPlus } from "lucide-react";

import { BulkImportWizard } from "../../../components/iam/BulkImportWizard";
import { DepartmentManager } from "../../../components/iam/DepartmentManager";
import { DepartmentTree } from "../../../components/iam/DepartmentTree";
import { MembersRoster, type MembersDeptFilter } from "../../../components/iam/MembersRoster";
import { UserGroupsPanel } from "../../../components/iam/UserGroupsPanel";

function readDept(raw: string | null): MembersDeptFilter {
  if (!raw || raw === "all") return "all";
  if (raw === "unassigned") return "unassigned";
  return raw;
}

function MembersPageContent() {
  const t = useTranslations("pages.iam.members");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [refreshKey, setRefreshKey] = useState(0);

  const tab = searchParams.get("tab") === "groups" ? "groups" : "members";
  const deptId = readDept(searchParams.get("dept"));
  const focusUserId = searchParams.get("user");
  const createOpen = searchParams.get("create") === "1";
  const importOpen = searchParams.get("import") === "1";
  const orgOpen = searchParams.get("org") === "1";

  const replaceParams = useCallback(
    (mutate: (params: URLSearchParams) => void) => {
      const params = new URLSearchParams(searchParams.toString());
      mutate(params);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setFlag = (key: "create" | "import" | "org", on: boolean) => {
    replaceParams((params) => {
      if (on) params.set(key, "1");
      else params.delete(key);
    });
  };

  const bump = () => setRefreshKey((value) => value + 1);

  return (
    <div className="space-y-5">
      <PageHeader title={t("title")} description={t("description")} />
      <Tabs
        value={tab}
        onValueChange={(value) => {
          replaceParams((params) => {
            if (value === "groups") params.set("tab", "groups");
            else params.delete("tab");
          });
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="members">{t("tabMembers")}</TabsTrigger>
            <TabsTrigger value="groups">{t("tabGroups")}</TabsTrigger>
          </TabsList>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setFlag("org", true)}>
              <Building2 />
              {t("editOrg")}
            </Button>
            {tab === "members" ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setFlag("import", true)}>
                  <Upload />
                  {t("import")}
                </Button>
                <Button size="sm" onClick={() => setFlag("create", true)}>
                  <UserPlus />
                  {t("newUser")}
                </Button>
              </>
            ) : null}
          </div>
        </div>

        <TabsContent value="members" className="mt-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            <DepartmentTree
              selectedId={deptId}
              refreshKey={refreshKey}
              onSelect={(id) => {
                replaceParams((params) => {
                  if (id === "all") params.delete("dept");
                  else params.set("dept", id);
                });
              }}
            />
            <div className="min-w-0 flex-1">
              <MembersRoster
                deptId={deptId}
                hideDeptFilter
                createOpen={createOpen}
                onCreateOpenChange={(open) => setFlag("create", open)}
                refreshKey={refreshKey}
                focusUserId={focusUserId}
                onDeptIdChange={(id) => {
                  replaceParams((params) => {
                    if (id === "all") params.delete("dept");
                    else params.set("dept", id);
                  });
                }}
              />
            </div>
          </div>
        </TabsContent>

        <TabsContent value="groups" className="mt-4">
          <UserGroupsPanel />
        </TabsContent>
      </Tabs>

      <Dialog
        open={orgOpen}
        onOpenChange={(open) => {
          setFlag("org", open);
          if (!open) bump();
        }}
      >
        <DialogContent className="flex h-[min(90vh,860px)] w-[min(1100px,calc(100vw-2rem))] max-w-6xl flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <DialogTitle>{t("orgDialogTitle")}</DialogTitle>
            <DialogDescription>{t("orgDialogDescription")}</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1">
            {orgOpen ? (
              <DepartmentManager
                onShowMembers={(id) => {
                  replaceParams((params) => {
                    params.delete("org");
                    params.delete("tab");
                    params.set("dept", id);
                  });
                  bump();
                }}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          setFlag("import", open);
          if (!open) bump();
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-5xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("importDialogTitle")}</DialogTitle>
            <DialogDescription>{t("importDialogDescription")}</DialogDescription>
          </DialogHeader>
          <BulkImportWizard
            onDone={() => {
              setFlag("import", false);
              bump();
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function MembersPage() {
  const t = useTranslations("pages.iam.members");
  return (
    <Suspense fallback={<div className="p-8 text-center text-muted-foreground">{t("loading")}</div>}>
      <MembersPageContent />
    </Suspense>
  );
}
