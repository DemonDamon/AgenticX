import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from "react-native";
import { brand, color, fontSize, fontWeight, radius, shadow, spacing } from "./theme";

type Variant = "primary" | "secondary" | "danger";

interface VariantPalette {
  base: ViewStyle;
  pressed: ViewStyle;
  text: { color: string };
  spinner: string;
}

/**
 * 统一按钮：primary=品牌橙实心，secondary=橙描边白底，danger=红。
 * 全部圆角 12，与桌面端卡片圆角尺度一致。
 */
export function Button({
  title,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
  style,
}: {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const palette = paletteByVariant[variant];
  return (
    <Pressable
      role="button"
      accessibilityState={{ disabled: disabled || loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        palette.base,
        (disabled || loading) && styles.disabled,
        pressed && !disabled && palette.pressed,
        variant === "primary" ? shadow.card : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={palette.spinner} />
      ) : (
        <Text style={[styles.text, palette.text]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    paddingVertical: 13,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  text: {
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
  },
  disabled: {
    opacity: 0.5,
  },
});

const paletteByVariant: Record<Variant, VariantPalette> = {
  primary: {
    base: { backgroundColor: brand.primary },
    pressed: { backgroundColor: brand.primaryPressed },
    text: { color: color.textOnPrimary },
    spinner: color.textOnPrimary,
  },
  secondary: {
    base: {
      backgroundColor: "#FFFFFF",
      borderWidth: 1.5,
      borderColor: brand.primary,
    },
    pressed: { backgroundColor: brand.cream },
    text: { color: brand.primary },
    spinner: brand.primary,
  },
  danger: {
    base: {
      backgroundColor: "#FFFFFF",
      borderWidth: 1.5,
      borderColor: color.danger,
    },
    pressed: { backgroundColor: color.dangerBg },
    text: { color: color.danger },
    spinner: color.danger,
  },
};
