import type { BrandConfig, FeatureFlags } from "@agenticx/config";
import type { ChatClient } from "@agenticx/sdk-ts";
import type { ReactNode } from "react";

export type RulePackMeta = {
  id: string;
  name: string;
  description?: string;
};

export type ChatWorkspaceSlots = {
  header?: ReactNode;
  sidebar?: ReactNode;
  footer?: ReactNode;
};

export type ChatWorkspaceProps = {
  brand: BrandConfig;
  features: FeatureFlags;
  rulePacks?: RulePackMeta[];
  client: ChatClient;
  slots?: ChatWorkspaceSlots;
};

