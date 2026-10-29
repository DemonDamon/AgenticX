import { notFound } from "next/navigation";
import { isPlatformSection } from "../../../lib/admin-platform-sections";
import AgentEnvironmentsSection from "../_sections/agent-environments";
import AgentEvalsSection from "../_sections/agent-evals";
import AgentMemorySection from "../_sections/agent-memory";
import AgentChannelsSection from "../_sections/agent-channels";
import AgentSchedulesSection from "../_sections/agent-schedules";
import AgentWebhooksSection from "../_sections/agent-webhooks";
import AgentVaultsSection from "../_sections/agent-vaults";
import AgentsSection from "../_sections/agents";
import ApiTokensSection from "../_sections/api-tokens";
import CacheSection from "../_sections/cache";
import CapabilitiesSection from "../_sections/capabilities";
import CasesSection from "../_sections/cases";
import ChannelsSection from "../_sections/channels";
import ConnectorsSection from "../_sections/connectors";
import McpServersSection from "../_sections/mcp-servers";
import ModelsSection from "../_sections/models";
import PluginsSection from "../_sections/plugins";
import DataGovernanceSection from "../_sections/data-governance";
import DataBoardsSection from "../_sections/data-boards";
import DataSecuritySection from "../_sections/data-security";
import RuleGovernanceSection from "../_sections/rule-governance";
import KnowledgeLifecycleSection from "../_sections/knowledge-lifecycle";
import DisambiguationSection from "../_sections/disambiguation";
import ProjectsSection from "../_sections/projects";

const PLATFORM_SECTION_PAGES = {
  agents: AgentsSection,
  "agent-environments": AgentEnvironmentsSection,
  "agent-vaults": AgentVaultsSection,
  "agent-memory": AgentMemorySection,
  "agent-evals": AgentEvalsSection,
  "agent-schedules": AgentSchedulesSection,
  "agent-webhooks": AgentWebhooksSection,
  "agent-channels": AgentChannelsSection,
  models: ModelsSection,
  channels: ChannelsSection,
  cache: CacheSection,
  "api-tokens": ApiTokensSection,
  "mcp-servers": McpServersSection,
  connectors: ConnectorsSection,
  capabilities: CapabilitiesSection,
  projects: ProjectsSection,
  cases: CasesSection,
  plugins: PluginsSection,
  "data-governance": DataGovernanceSection,
  "data-boards": DataBoardsSection,
  "data-security": DataSecuritySection,
  "rule-governance": RuleGovernanceSection,
  "knowledge-lifecycle": KnowledgeLifecycleSection,
  "disambiguation": DisambiguationSection,
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
