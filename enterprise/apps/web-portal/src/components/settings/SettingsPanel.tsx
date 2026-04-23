"use client";

import { Badge, Card, CardContent, CardHeader, CardTitle, Input, Label, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsContent, TabsList, TabsTrigger } from "@agenticx/ui";
import { usePortalCopy } from "../../lib/portal-copy";

export function SettingsPanel() {
  const t = usePortalCopy();

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#121212]">
      <header className="border-b border-zinc-800 px-6 py-4">
        <h2 className="text-lg font-semibold">{t.settings}</h2>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-6">
        <Tabs defaultValue="model-service" className="flex min-h-0 flex-col gap-4">
          <TabsList className="grid h-auto grid-cols-2 gap-2 bg-transparent p-0 md:grid-cols-3 lg:grid-cols-6">
            <TabsTrigger value="model-service">{t.modelService}</TabsTrigger>
            <TabsTrigger value="defaults">{t.defaults}</TabsTrigger>
            <TabsTrigger value="web-search">{t.webSearch}</TabsTrigger>
            <TabsTrigger value="parser">{t.parser}</TabsTrigger>
            <TabsTrigger value="chat">{t.chat}</TabsTrigger>
            <TabsTrigger value="general">{t.general}</TabsTrigger>
          </TabsList>

          <TabsContent value="model-service">
            <Card className="border-zinc-800 bg-zinc-950">
              <CardHeader>
                <CardTitle>{t.modelService}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="provider">Provider</Label>
                  <Select defaultValue="deepseek">
                    <SelectTrigger id="provider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="deepseek">DeepSeek</SelectItem>
                      <SelectItem value="moonshot">Moonshot</SelectItem>
                      <SelectItem value="openai">OpenAI</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="api-key">API Key</Label>
                  <Input id="api-key" placeholder="sk-..." />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="defaults">
            <Card className="border-zinc-800 bg-zinc-950">
              <CardHeader>
                <CardTitle>{t.defaults}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-zinc-300">
                <p>Default chat model: `deepseek-chat`</p>
                <p>Session naming model: `moonshot-v1-8k`</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="web-search">
            <Card className="border-zinc-800 bg-zinc-950">
              <CardHeader>
                <CardTitle>{t.webSearch}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <Badge variant="success">Web search enabled</Badge>
                <Input placeholder="Search provider API key" />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="parser">
            <Card className="border-zinc-800 bg-zinc-950">
              <CardHeader>
                <CardTitle>{t.parser}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-zinc-300">
                <p>Parser mode: Machi AI</p>
                <p>Supported: PDF / Word / Excel / PPT / Images</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="chat">
            <Card className="border-zinc-800 bg-zinc-950">
              <CardHeader>
                <CardTitle>{t.chat}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-zinc-300">
                <p>Streaming output enabled</p>
                <p>Auto title enabled</p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="general">
            <Card className="border-zinc-800 bg-zinc-950">
              <CardHeader>
                <CardTitle>{t.general}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-zinc-300">
                <p>Language and theme are synced from user menu.</p>
                <p>Data export/import workflow will be connected in next phase.</p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </section>
  );
}

