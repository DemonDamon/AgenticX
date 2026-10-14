import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CapabilityCard } from "../src/components/CapabilityCard";
import {
  Chip,
  OptionRow,
  PickerSheet,
  SheetAction,
  SheetNote,
  StatePill,
} from "../src/components/PickerSheet";
import { useGateway } from "../src/hooks/useGateway";
import { describeError } from "../src/lib/errors";
import type { MobileStatus, MobileWorkspace, ModelsResponse } from "../src/api/types";
import { getPreferredWorkspace, setPreferredWorkspace } from "../src/store";
import { brand, color, fontSize, fontWeight, radius, shadow, spacing } from "../src/ui/theme";

/** 取路径末段作为项目/目录展示名（兼容结尾斜杠与根路径）。 */
function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

/** 去掉 LiteLLM 路由前缀（ZHIPU/glm-5.2 → glm-5.2），仅用于展示。 */
function bareModel(model: string): string {
  const trimmed = model.trim();
  const idx = trimmed.indexOf("/");
  return idx > 0 ? trimmed.slice(idx + 1) : trimmed;
}

interface ModelOption {
  provider: string;
  /** 传给桌面端的原始模型 id（可能带前缀） */
  model: string;
  /** 展示用短名 */
  label: string;
  providerLabel: string;
}

/** providers 清单 → 可选项（跳过 disabled / 无模型的厂商）。 */
function buildModelOptions(models: ModelsResponse | null): ModelOption[] {
  if (models === null) return [];
  const out: ModelOption[] = [];
  for (const [pid, entry] of Object.entries(models.providers ?? {})) {
    if (entry === null || typeof entry !== "object") continue;
    if (entry.enabled === false) continue;
    const raw = Array.isArray(entry.models)
      ? entry.models
      : typeof entry.model === "string"
        ? [entry.model]
        : [];
    const display =
      typeof entry.displayName === "string" && entry.displayName.length > 0
        ? entry.displayName
        : typeof entry.display_name === "string" && entry.display_name.length > 0
          ? entry.display_name
          : pid;
    for (const item of raw) {
      const model = String(item).trim();
      if (model === "") continue;
      out.push({ provider: pid, model, label: bareModel(model), providerLabel: display });
    }
  }
  return out;
}

/**
 * 首页（对标 Trae / Claude 手机端）：打开 APP 直达对话起始页。
 * - 大标语 + 底部输入卡（动作行：＋能力速览 / 模型 pill / 发送）+ 设备上下文 pill 行
 * - 首条消息发出时懒创建会话；左上角入口 → 「全部任务」列表
 * - 未绑定 → pair；绑定读取中先展示轻量分发
 */
export default function Index() {
  const insets = useSafeAreaInsets();
  const { client, binding, loadError } = useGateway();
  const [draft, setDraft] = useState("");
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<MobileStatus | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [capsOpen, setCapsOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // 三个底部选择面板（对标 Trae：模型 / 当前活跃项目 / 运行位置）
  const [modelsOpen, setModelsOpen] = useState(false);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelSwitching, setModelSwitching] = useState(false);
  const [workspacesOpen, setWorkspacesOpen] = useState(false);
  const [workspaces, setWorkspaces] = useState<MobileWorkspace[]>([]);
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState<string | null>(null);
  const [locationOpen, setLocationOpen] = useState(false);

  const showToast = useCallback((text: string) => {
    setToast(text);
    setTimeout(() => {
      setToast(null);
    }, 2_500);
  }, []);

  // 拉桌面状态（在线/桌面名）+ 最近会话（模型兜底 / 工作目录），失败静默降级
  useEffect(() => {
    if (client === null) return;
    let cancelled = false;
    void client
      .getStatus()
      .then((s) => {
        if (!cancelled) setStatus(s);
      })
      .catch(() => {});
    void client
      .getSessions()
      .then((resp) => {
        if (cancelled) return;
        const first = resp.sessions[0];
        if (first === undefined) return;
        if (typeof first.model === "string") setModel(first.model);
        // 老会话可能没记录工作目录，取最近一条有记录的作为当前活跃项目
        const wd =
          resp.sessions.find(
            (s) => typeof s.workspace_dir === "string" && s.workspace_dir !== "",
          )?.workspace_dir ?? "";
        // 优先沿用手机端选择过的项目；否则跟随最近会话的工作目录
        void getPreferredWorkspace().then((preferred) => {
          if (cancelled) return;
          setActiveWorkspace(preferred ?? (typeof wd === "string" && wd !== "" ? wd : null));
        });
      })
      .catch(() => {});
    // 候选工作目录随首页一起拉一次，供 pill 展示可读项目名（失败静默）
    void client
      .getWorkspaces()
      .then((resp) => {
        if (!cancelled) setWorkspaces(resp.workspaces);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [client]);

  const loadModels = useCallback(async () => {
    if (client === null) return;
    setModelsLoading(true);
    try {
      setModels(await client.getModels());
    } catch (err) {
      showToast(`读取模型清单失败：${describeError(err)}`);
    } finally {
      setModelsLoading(false);
    }
  }, [client, showToast]);

  const loadWorkspaces = useCallback(async () => {
    if (client === null) return;
    setWorkspacesLoading(true);
    try {
      const resp = await client.getWorkspaces();
      setWorkspaces(resp.workspaces);
    } catch (err) {
      showToast(`读取工作项目失败：${describeError(err)}`);
    } finally {
      setWorkspacesLoading(false);
    }
  }, [client, showToast]);

  const handleSelectModel = useCallback(
    async (option: ModelOption) => {
      if (client === null) return;
      setModelSwitching(true);
      try {
        await client.setActiveModel(option.provider, option.model);
        setModel(option.model);
        setModels((prev) =>
          prev === null
            ? prev
            : { ...prev, activeProvider: option.provider, activeModel: option.model },
        );
        setModelsOpen(false);
      } catch (err) {
        showToast(`切换模型失败：${describeError(err)}`);
      } finally {
        setModelSwitching(false);
      }
    },
    [client, showToast],
  );

  const handleSelectWorkspace = useCallback((ws: MobileWorkspace) => {
    setActiveWorkspace(ws.path);
    void setPreferredWorkspace(ws.path);
    setWorkspacesOpen(false);
  }, []);

  const handleStart = useCallback(async () => {
    const text = draft.trim();
    if (text === "" || creating || client === null) return;
    setCreating(true);
    try {
      const resp = await client.createSession(
        activeWorkspace !== null ? { workspace_dir: activeWorkspace } : {},
      );
      router.push({
        pathname: "/sessions/[id]",
        params: { id: resp.session_id, title: text.slice(0, 20), initialText: text },
      });
    } catch (err) {
      setToast(`创建任务失败：${describeError(err)}`);
      setCreating(false);
      setTimeout(() => {
        setToast(null);
      }, 2_500);
    }
  }, [draft, creating, client, activeWorkspace]);

  const canSend = creating || draft.trim() === "";

  // 未绑定 / 绑定读取失败：轻量分发（真正 UI 是配对页）
  if (binding === null) {
    return (
      <View style={styles.center}>
        {loadError === null ? (
          <ActivityIndicator size="large" color={brand.primary} />
        ) : (
          <>
            <Text style={styles.centerError}>初始化失败：{loadError}</Text>
            <Pressable
              style={({ pressed }) => [styles.pairButton, pressed && styles.pairPressed]}
              onPress={() => router.replace("/pair")}
            >
              <Text style={styles.pairButtonText}>去配对</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

  const desktopName = status?.desktop_name ?? "桌面端";
  const online = status?.online === true;

  // 动作行 / 上下文行展示值（模型优先取桌面端活动模型，项目取选择或最近会话）
  const modelOptions = buildModelOptions(models);
  const activeModelId = models?.activeModel ?? model ?? "";
  const activeProviderId = models?.activeProvider ?? "";
  const modelLabel = activeModelId !== "" ? bareModel(activeModelId) : null;
  const activeWorkspaceName =
    activeWorkspace !== null && activeWorkspace !== ""
      ? (workspaces.find((w) => w.path === activeWorkspace)?.name ?? basename(activeWorkspace))
      : null;

  return (
    <View style={styles.page}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* 左上角：全部任务入口 */}
        <View style={[styles.topBar, { paddingTop: insets.top + spacing.xs }]}>
          <Pressable
            style={({ pressed }) => [styles.listEntry, pressed && styles.listEntryPressed]}
            onPress={() => {
              router.push("/sessions");
            }}
            hitSlop={8}
          >
            <Ionicons name="chevron-back" size={22} color={color.textPrimary} />
          </Pressable>
        </View>

        {/* 大标语 */}
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>Hey，我是 Near</Text>
          <Text style={styles.heroSub}>桌面智能体，随时待命</Text>
          <View style={styles.heroStatus}>
            <View
              style={[
                styles.statusDot,
                status === null ? styles.statusDotMuted : online ? styles.statusDotOnline : styles.statusDotOffline,
              ]}
            />
            <Text style={styles.heroStatusText}>
              {status === null ? "正在连接桌面端…" : `${desktopName} · ${online ? "在线" : "离线"}`}
            </Text>
          </View>
        </View>

        {/* ＋ 展开：能力速览 */}
        {capsOpen ? (
          <View style={styles.capsWrap}>
            <CapabilityCard client={client} />
          </View>
        ) : null}

        {/* 底部输入卡（对标 Trae/Claude 层次：输入区 → 动作行） */}
        <View style={styles.inputCard}>
          <TextInput
            style={styles.input}
            multiline
            placeholder="发消息给 Near…"
            placeholderTextColor={color.textMuted}
            value={draft}
            onChangeText={setDraft}
            editable={!creating}
          />
          <View style={styles.actionRow}>
            <Pressable
              style={({ pressed }) => [styles.iconButton, pressed && styles.iconPressed]}
              onPress={() => {
                setCapsOpen((v) => !v);
              }}
              hitSlop={6}
            >
              <Ionicons name={capsOpen ? "close" : "add"} size={22} color={color.textSecondary} />
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.modelPill, pressed && styles.modelPillPressed]}
              onPress={() => {
                setModelsOpen(true);
                if (models === null) void loadModels();
              }}
              hitSlop={6}
            >
              <Ionicons name="sparkles" size={12} color={brand.primary} />
              <Text style={styles.modelPillText} numberOfLines={1}>
                {modelLabel ?? "选择模型"}
              </Text>
              <Ionicons name="chevron-down" size={12} color={color.textMuted} />
            </Pressable>
            <View style={styles.spacer} />
            <Pressable
              style={({ pressed }) => [
                styles.sendButton,
                canSend ? styles.sendDisabled : null,
                pressed && !canSend ? styles.sendPressed : null,
              ]}
              disabled={canSend}
              onPress={() => {
                void handleStart();
              }}
            >
              {creating ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Ionicons name="arrow-up" size={20} color="#FFFFFF" />
              )}
            </Pressable>
          </View>
        </View>

        {/* 设备上下文 pill 行 */}
        <View style={styles.contextRow}>
          <Pressable
            style={({ pressed }) => [styles.contextPill, pressed && styles.contextPillPressed]}
            onPress={() => {
              setLocationOpen(true);
            }}
          >
            <Ionicons name="desktop-outline" size={14} color={color.textSecondary} />
            <Text style={styles.contextPillText} numberOfLines={1}>
              {desktopName}
            </Text>
            <Ionicons name="chevron-down" size={12} color={color.textMuted} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.contextPill, pressed && styles.contextPillPressed]}
            onPress={() => {
              setWorkspacesOpen(true);
              void loadWorkspaces();
            }}
          >
            <Ionicons name="folder-outline" size={14} color={color.textSecondary} />
            <Text style={styles.contextPillText} numberOfLines={1}>
              {activeWorkspaceName ?? "当前活跃项目"}
            </Text>
            <Ionicons name="chevron-down" size={12} color={color.textMuted} />
          </Pressable>
        </View>
        <View style={{ height: Math.max(insets.bottom, spacing.sm) }} />
      </KeyboardAvoidingView>

      {/* 选择模型（动作行 pill） */}
      <PickerSheet
        visible={modelsOpen}
        onClose={() => setModelsOpen(false)}
        title="选择模型"
        footer={<SheetNote text="切换后对后续新建任务生效。" />}
      >
        {modelsLoading ? <SheetNote text="正在读取模型清单…" /> : null}
        {!modelsLoading && modelOptions.length === 0 ? (
          <SheetNote text="桌面端未配置可用模型，请先在 Near 桌面端添加模型服务。" />
        ) : null}
        {modelOptions.map((option) => (
          <OptionRow
            key={`${option.provider}/${option.model}`}
            label={option.label}
            sublabel={option.providerLabel}
            selected={option.provider === activeProviderId && option.model === activeModelId}
            onPress={() => {
              void handleSelectModel(option);
            }}
          />
        ))}
        {modelSwitching ? <SheetNote text="正在切换…" /> : null}
      </PickerSheet>

      {/* 当前活跃项目（文件夹 pill） */}
      <PickerSheet
        visible={workspacesOpen}
        onClose={() => setWorkspacesOpen(false)}
        title="当前活跃项目"
        footer={
          <SheetNote text="没找到你需要的工作项目？可先在 Near 桌面端打开需要使用的窗口。" />
        }
      >
        {workspacesLoading ? <SheetNote text="正在读取工作目录…" /> : null}
        {!workspacesLoading && workspaces.length === 0 ? (
          <SheetNote text="还没有可用的工作项目，先在桌面端开一个任务吧。" />
        ) : null}
        {workspaces.map((ws) => (
          <OptionRow
            key={ws.path}
            variant="check"
            label={ws.name}
            sublabel={ws.path}
            selected={ws.path === activeWorkspace}
            outlined={ws.path === activeWorkspace}
            onPress={() => {
              handleSelectWorkspace(ws);
            }}
          />
        ))}
      </PickerSheet>

      {/* 选择任务运行位置（设备 pill） */}
      <PickerSheet
        visible={locationOpen}
        onClose={() => setLocationOpen(false)}
        title="选择任务运行位置"
        footer={
          <SheetAction
            label="连接你的电脑"
            onPress={() => {
              setLocationOpen(false);
              router.push("/pair");
            }}
          />
        }
      >
        <OptionRow
          variant="radio"
          icon="desktop-outline"
          label={desktopName}
          selected
          outlined
          badge={<Chip label="Near" />}
          right={<StatePill online={online} />}
          onPress={() => setLocationOpen(false)}
        />
        <SheetNote text="AgenticX 目前在一台桌面端上运行；「云端」运行位置暂未开放。" />
      </PickerSheet>

      {toast !== null ? (
        <View style={styles.toast} pointerEvents="none">
          <Text style={styles.toastText}>{toast}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  flex: { flex: 1 },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    padding: spacing.lg,
    backgroundColor: color.bg,
  },
  centerError: {
    color: color.danger,
    fontSize: fontSize.body,
    textAlign: "center",
  },
  pairButton: {
    borderWidth: 1.5,
    borderColor: brand.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.xl,
    paddingVertical: 11,
    backgroundColor: "#FFFFFF",
  },
  pairPressed: { backgroundColor: brand.cream },
  pairButtonText: {
    color: brand.primary,
    fontSize: fontSize.body,
    fontWeight: fontWeight.semibold,
  },
  topBar: {
    paddingHorizontal: spacing.lg,
  },
  listEntry: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: color.border,
    alignItems: "center",
    justifyContent: "center",
    ...shadow.card,
  },
  listEntryPressed: { backgroundColor: brand.cream },
  hero: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xl + 4,
    gap: spacing.xs,
  },
  heroTitle: {
    fontSize: 34,
    lineHeight: 44,
    fontWeight: fontWeight.bold,
    color: color.textPrimary,
  },
  heroSub: {
    fontSize: fontSize.bodyLg,
    color: color.textMuted,
    marginTop: spacing.xs,
  },
  heroStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.md,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDotOnline: { backgroundColor: color.online },
  statusDotOffline: { backgroundColor: color.offline },
  statusDotMuted: { backgroundColor: color.offline },
  heroStatusText: {
    fontSize: fontSize.body,
    color: color.textSecondary,
  },
  capsWrap: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  inputCard: {
    marginHorizontal: spacing.lg,
    backgroundColor: "#FFFFFF",
    borderRadius: radius.lg + 4,
    borderWidth: 1,
    borderColor: color.border,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
    ...shadow.floating,
  },
  input: {
    minHeight: 56,
    maxHeight: 140,
    fontSize: fontSize.bodyLg,
    color: color.textPrimary,
    lineHeight: 22,
    textAlignVertical: "top",
    paddingHorizontal: spacing.xs,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  iconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: color.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  iconPressed: { backgroundColor: brand.cream },
  modelPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: brand.cream,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    height: 32,
    maxWidth: 200,
  },
  modelPillText: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
    color: color.textPrimary,
    flexShrink: 1,
  },
  modelPillPressed: { backgroundColor: brand.creamDeep },
  spacer: { flex: 1 },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: brand.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendPressed: { backgroundColor: brand.primaryPressed },
  sendDisabled: { backgroundColor: color.borderStrong },
  contextRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  contextPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    maxWidth: "48%",
  },
  contextPillPressed: { backgroundColor: brand.cream },
  contextPillText: {
    fontSize: fontSize.caption,
    color: color.textSecondary,
    flexShrink: 1,
  },
  toast: {
    position: "absolute",
    bottom: 140,
    alignSelf: "center",
    backgroundColor: "rgba(43, 38, 32, 0.92)",
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    maxWidth: "82%",
  },
  toastText: { color: "#FFFFFF", fontSize: fontSize.body },
});
