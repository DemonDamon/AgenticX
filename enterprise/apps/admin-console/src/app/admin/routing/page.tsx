import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@agenticx/ui";
import { Route, ShieldCheck, Sparkles } from "lucide-react";

export default function RoutingPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6 py-2">
      <div>
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <Route className="h-4 w-4" />
          模型服务
        </div>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">自动路由</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          为不同请求自动选择合适的模型服务。入口已保留，具体路由策略将在可配置、可解释后开放。
        </p>
      </div>

      <Card className="border-dashed">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="h-5 w-5 text-primary" />
                路由策略准备中
              </CardTitle>
              <CardDescription>当前不会改变任何请求的模型选择或用量记录。</CardDescription>
            </div>
            <Badge variant="secondary">即将开放</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm text-muted-foreground sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <p className="font-medium text-foreground">按任务选择模型</p>
            <p className="mt-1">根据任务类型、模型能力与可用性给出可说明的选择。</p>
          </div>
          <div className="rounded-lg border border-border bg-muted/20 p-4">
            <p className="flex items-center gap-1.5 font-medium text-foreground"><ShieldCheck className="h-4 w-4 text-success" />保留合规边界</p>
            <p className="mt-1">策略、脱敏与审计仍按现有规则先行处理。</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
