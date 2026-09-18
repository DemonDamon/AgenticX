import { notFound } from "next/navigation";
import { isPlatformSection } from "../../../lib/admin-platform-sections";
import ApiTokensSection from "../_sections/api-tokens";
import CacheSection from "../_sections/cache";
import CapabilitiesSection from "../_sections/capabilities";
import ChannelsSection from "../_sections/channels";
import McpServersSection from "../_sections/mcp-servers";
import ModelsSection from "../_sections/models";
import PluginsSection from "../_sections/plugins";

const PLATFORM_SECTION_PAGES = {
  models: ModelsSection,
  channels: ChannelsSection,
  cache: CacheSection,
  "api-tokens": ApiTokensSection,
  "mcp-servers": McpServersSection,
  capabilities: CapabilitiesSection,
  plugins: PluginsSection,
} as const;

export default async function AdminPlatformSectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  if (!isPlatformSection(section)) {
    notFound();
  }
  const Section = PLATFORM_SECTION_PAGES[section];
  return <Section />;
}
