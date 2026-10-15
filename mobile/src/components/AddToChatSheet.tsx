/**
 * 「添加到对话」底部面板：拍照 / 相册 / 飞书文档 / 技能。
 *
 * 结构对齐主流移动端 AI 客户端的 composer 加号面板：
 * 顶部两宫格入口卡（拍照、相册），下方是带右箭头的资源入口行，
 * 点击后在同一面板内切换到子列表（技能支持搜索）。
 */

import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import type { GatewayClient } from "../api/client";
import type { MobileDoc, MobileSkill } from "../api/types";
import { color, fontSize, fontWeight, radius, spacing } from "../ui/theme";
import { PickerSheet, SheetNote } from "./PickerSheet";

type IoniconName = keyof typeof Ionicons.glyphMap;
type SheetView = "root" | "skills" | "docs";

export interface AddToChatSheetProps {
  visible: boolean;
  onClose: () => void;
  client: GatewayClient | null;
  /** 拍照 / 相册：交宿主调起系统图片选择 */
  onPickImage: (source: "camera" | "library") => void;
  /** 选定技能：作为本轮 skill_slugs 下发 */
  onSelectSkill: (skill: MobileSkill) => void;
  /** 已选技能名，用于列表勾选态 */
  selectedSkills: readonly string[];
  /** 选定飞书文档：作为本轮 doc_refs 下发 */
  onSelectDoc: (doc: MobileDoc) => void;
  /** 已选文档 token，用于列表勾选态 */
  selectedDocs: readonly string[];
}

export function AddToChatSheet({
  visible,
  onClose,
  client,
  onPickImage,
  onSelectSkill,
  selectedSkills,
  onSelectDoc,
  selectedDocs,
}: AddToChatSheetProps) {
  const [view, setView] = useState<SheetView>("root");
  const [skills, setSkills] = useState<MobileSkill[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // 飞书文档：远程搜索（桌面端连接器），带防抖
  const [docQuery, setDocQuery] = useState("");
  const [docs, setDocs] = useState<MobileDoc[] | null>(null);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);
  const docsSeq = useRef(0);

  // 关闭后回到根视图，下次打开始终是入口列表
  useEffect(() => {
    if (!visible) {
      setView("root");
      setQuery("");
      setDocQuery("");
      setDocs(null);
      setDocsError(null);
    }
  }, [visible]);

  const loadSkills = useCallback(() => {
    if (client === null) {
      setError("未连接桌面端");
      return;
    }
    setLoading(true);
    setError(null);
    client
      .getSkills()
      .then((resp) => setSkills(resp.skills))
      .catch((exc: unknown) => {
        setSkills(null);
        setError(exc instanceof Error ? exc.message : "技能加载失败");
      })
      .finally(() => setLoading(false));
  }, [client]);

  // 首次进入技能页时拉取（失败可重试）
  useEffect(() => {
    if (visible && view === "skills" && skills === null && !loading) {
      loadSkills();
    }
  }, [visible, view, skills, loading, loadSkills]);

  const filtered = useMemo(() => {
    const rows = skills ?? [];
    const q = query.trim().toLowerCase();
    if (q === "") return rows;
    return rows.filter(
      (s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [skills, query]);

  const handlePick = (source: "camera" | "library") => {
    onClose();
    onPickImage(source);
  };

  // 飞书文档搜索：500ms 防抖，序号防过期响应覆盖新结果
  useEffect(() => {
    if (!visible || view !== "docs" || client === null) return;
    const q = docQuery.trim();
    if (q === "") {
      setDocs(null);
      setDocsError(null);
      return;
    }
    const seq = ++docsSeq.current;
    const timer = setTimeout(() => {
      setDocsLoading(true);
      setDocsError(null);
      client
        .searchDocs(q)
        .then((resp) => {
          if (docsSeq.current !== seq) return;
          setDocs(resp.docs);
        })
        .catch((exc: unknown) => {
          if (docsSeq.current !== seq) return;
          setDocs(null);
          setDocsError(exc instanceof Error ? exc.message : "飞书文档搜索失败");
        })
        .finally(() => {
          if (docsSeq.current === seq) setDocsLoading(false);
        });
    }, 500);
    return () => {
      clearTimeout(timer);
    };
  }, [visible, view, docQuery, client]);

  const fmtDocDate = (iso: string): string => (iso.length >= 10 ? iso.slice(0, 10) : "");

  if (view === "skills") {
    return (
      <PickerSheet visible={visible} onClose={onClose} title="你的技能" onBack={() => setView("root")}>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={color.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="搜索技能"
            placeholderTextColor={color.textMuted}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={color.textMuted} />
          </View>
        ) : error !== null ? (
          <SheetNote text={error} tone="danger" />
        ) : filtered.length === 0 ? (
          <SheetNote text={query.trim() === "" ? "桌面端暂无可用技能。" : `没有匹配「${query.trim()}」的技能。`} />
        ) : (
          filtered.map((skill) => {
            const selected = selectedSkills.includes(skill.name);
            return (
              <Pressable
                key={skill.name}
                onPress={() => onSelectSkill(skill)}
                style={({ pressed }) => [styles.skillRow, pressed && styles.pressedBg]}
              >
                <View style={styles.skillIcon}>
                  <Ionicons name="book-outline" size={20} color={color.textPrimary} />
                </View>
                <View style={styles.skillMain}>
                  <Text style={styles.skillName} numberOfLines={1}>
                    {skill.name}
                  </Text>
                  {skill.description !== "" ? (
                    <Text style={styles.skillDesc} numberOfLines={1}>
                      {skill.description}
                    </Text>
                  ) : null}
                </View>
                {selected ? (
                  <Ionicons name="checkmark" size={20} color={color.textPrimary} />
                ) : null}
              </Pressable>
            );
          })
        )}
      </PickerSheet>
    );
  }

  if (view === "docs") {
    return (
      <PickerSheet visible={visible} onClose={onClose} title="飞书文档" onBack={() => setView("root")}>
        <View style={styles.search}>
          <Ionicons name="search" size={18} color={color.textMuted} />
          <TextInput
            value={docQuery}
            onChangeText={setDocQuery}
            placeholder="搜索飞书文档"
            placeholderTextColor={color.textMuted}
            style={styles.searchInput}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />
        </View>
        {docsLoading ? (
          <View style={styles.center}>
            <ActivityIndicator color={color.textMuted} />
          </View>
        ) : docsError !== null ? (
          <SheetNote text={docsError} tone="danger" />
        ) : docs === null ? (
          <SheetNote text="输入关键词搜索你的飞书文档、Wiki 与表格，选中后随消息一起发给 Near。" />
        ) : docs.length === 0 ? (
          <SheetNote text={`没有匹配「${docQuery.trim()}」的文档。`} />
        ) : (
          docs.map((doc) => {
            const selected = selectedDocs.includes(doc.token);
            const sub = [
              doc.owner_name !== "" ? doc.owner_name : "",
              fmtDocDate(doc.update_time_iso ?? ""),
            ]
              .filter((s) => s !== "")
              .join(" · ");
            return (
              <Pressable
                key={doc.token}
                onPress={() => onSelectDoc(doc)}
                style={({ pressed }) => [styles.skillRow, pressed && styles.pressedBg]}
              >
                <View style={styles.skillIcon}>
                  <Ionicons name="document-text-outline" size={20} color={color.textPrimary} />
                </View>
                <View style={styles.skillMain}>
                  <Text style={styles.skillName} numberOfLines={1}>
                    {doc.title}
                  </Text>
                  {sub !== "" ? (
                    <Text style={styles.skillDesc} numberOfLines={1}>
                      {sub}
                    </Text>
                  ) : null}
                </View>
                {selected ? (
                  <Ionicons name="checkmark" size={20} color={color.textPrimary} />
                ) : null}
              </Pressable>
            );
          })
        )}
      </PickerSheet>
    );
  }

  return (
    <PickerSheet visible={visible} onClose={onClose} title="添加到对话">
      <View style={styles.grid}>
        <GridCard icon="camera-outline" label="拍照" onPress={() => handlePick("camera")} />
        <GridCard icon="images-outline" label="相册" onPress={() => handlePick("library")} />
      </View>
      <EntryRow icon="document-text-outline" label="飞书文档" onPress={() => setView("docs")} />
      <EntryRow icon="book-outline" label="技能" onPress={() => setView("skills")} />
    </PickerSheet>
  );
}

/* ---------- 本面板专用原语 ---------- */

function GridCard({
  icon,
  label,
  onPress,
}: {
  icon: IoniconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.gridCard, pressed && styles.pressedBg]}
    >
      <Ionicons name={icon} size={26} color={color.textPrimary} />
      <Text style={styles.gridLabel}>{label}</Text>
    </Pressable>
  );
}

function EntryRow({
  icon,
  label,
  onPress,
}: {
  icon: IoniconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.entry, pressed && styles.pressedBg]}
    >
      <View style={styles.entryIcon}>
        <Ionicons name={icon} size={22} color={color.textPrimary} />
      </View>
      <Text style={styles.entryLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={20} color={color.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", gap: spacing.md, marginBottom: spacing.sm },
  gridCard: {
    flex: 1,
    backgroundColor: color.bg,
    borderRadius: radius.lg,
    paddingVertical: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
  },
  gridLabel: { fontSize: fontSize.bodyLg, color: color.textPrimary },
  pressedBg: { backgroundColor: color.bg },

  entry: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
  },
  entryIcon: { width: 26, alignItems: "center" },
  entryLabel: { flex: 1, fontSize: fontSize.bodyLg + 2, color: color.textPrimary },

  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: color.bg,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    height: 42,
    marginBottom: spacing.sm,
  },
  searchInput: { flex: 1, padding: 0, fontSize: fontSize.bodyLg, color: color.textPrimary },
  center: { paddingVertical: spacing.xl, alignItems: "center" },

  skillRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.lg,
  },
  skillIcon: { width: 26, alignItems: "center" },
  skillMain: { flex: 1, gap: 2 },
  skillName: { fontSize: fontSize.bodyLg + 1, color: color.textPrimary },
  skillDesc: { fontSize: fontSize.body, color: color.textMuted },
});
