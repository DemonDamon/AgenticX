import * as React from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@agenticx/ui";
import { useUsableViewport } from "../src/hooks/useUsableViewport";
import { usableViewportStyle } from "../src/utils/usable-viewport";
import { AttachmentContentPanel } from "../src/components/molecules/AttachmentContentPanel";
import { DeepResearchFilesPanel } from "../src/components/molecules/DeepResearchFilesPanel";
import { EmptyChatPane } from "../src/components/molecules/EmptyChatPane";
import "./style.css";

// A synthetic shell fixture: production geometry hook and preview components,
// controlled conversation content, no authentication or model service.
window.fetch = async () => new Response(JSON.stringify({ data: { artifacts: [] } }), {
  status: 200, headers: { "content-type": "application/json" },
});

function ViewportFixture() {
  const ref = React.useRef<HTMLElement>(null);
  const compact = useUsableViewport(ref);
  const [attachmentOpen, setAttachmentOpen] = React.useState(false);
  const [researchOpen, setResearchOpen] = React.useState(false);
  const empty = new URLSearchParams(location.search).has("empty");
  const composer = <div data-testid="composer" className="shrink-0 border-t border-border bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
    <textarea aria-label="Message" defaultValue="Draft survives geometry changes" style={empty ? { height: 156 } : undefined} className="block min-h-16 w-full resize-none rounded-xl border border-border bg-background p-3 text-base" />
  </div>;
  return <TooltipProvider>
    <main ref={ref} style={usableViewportStyle} data-testid="viewport-frame" data-compact={compact ?? undefined}
      className="fixed box-border flex min-h-0 min-w-0 overflow-hidden bg-background text-foreground">
      <div className="relative flex h-full min-h-0 w-full min-w-0 overflow-hidden">
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          {compact ? <button data-testid="compact-menu" aria-label="Menu" className="absolute left-3 top-4 z-20">☰</button> : null}
          <header data-chat-header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border p-3">
            <strong data-testid="chat-title" className="mr-auto">Chat</strong>
            <button data-testid="open-attachment" onClick={() => { setResearchOpen(false); setAttachmentOpen(true); }} className="rounded border border-border px-3 py-2">Preview</button>
            <button data-testid="open-research" onClick={() => { setAttachmentOpen(false); setResearchOpen(true); }} className="rounded border border-border px-3 py-2">Files</button>
          </header>
          {empty ? <div className="min-h-0 flex-1"><EmptyChatPane hero={<div data-testid="empty-hero" style={{ height: 250 }} className="flex items-center text-3xl">Welcome</div>}>{composer}</EmptyChatPane></div> : <>
          <div data-testid="reader" className="min-h-0 flex-1 overflow-y-auto p-4">
            {Array.from({ length: 70 }, (_, index) => <p key={index} className="mb-5 rounded bg-muted p-4">Synthetic conversation message {index + 1}. Reading older messages must preserve the current scroll position.</p>)}
          </div>
          {composer}
          </>}
        </section>
        <AttachmentContentPanel open={attachmentOpen} onOpenChange={setAttachmentOpen}
          attachment={{ name: "preview.md", mime_type: "text/markdown", parsed_text: "# Readable document\n\nThis is synthetic preview content.\n\nThe close action stays visible." }} />
        <DeepResearchFilesPanel open={researchOpen} onOpenChange={setResearchOpen} sessionId="synthetic-session" />
      </div>
    </main>
  </TooltipProvider>;
}

createRoot(document.getElementById("root")!).render(<ViewportFixture />);
