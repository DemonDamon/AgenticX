import { Image, ImageStyle, StyleProp, View, ViewStyle } from "react-native";
import { brand } from "./theme";

/**
 * Near 品牌 Mark：橙色立方体（透明底 PNG，源自 desktop 同源资产）。
 * 可选奶油色圆形底托，用于需要承载感的场景（启动区、空状态）。
 */
export function BrandMark({
  size = 72,
  plated = false,
  style,
  containerStyle,
}: {
  size?: number;
  plated?: boolean;
  /** 裸图分支：作用于 Image 的样式 */
  style?: StyleProp<ImageStyle>;
  /** plated 分支：作用于奶油色圆形底托的样式 */
  containerStyle?: StyleProp<ViewStyle>;
}) {
  if (!plated) {
    return (
      <Image
        source={require("../../assets/brand/near-box.png")}
        style={[{ width: size, height: size, resizeMode: "contain" }, style]}
      />
    );
  }
  const plate = size * 1.5;
  return (
    <View
      style={[
        {
          width: plate,
          height: plate,
          borderRadius: plate / 2,
          backgroundColor: brand.creamDeep,
          alignItems: "center",
          justifyContent: "center",
        },
        containerStyle,
      ]}
    >
      <Image
        source={require("../../assets/brand/near-box.png")}
        style={{ width: size, height: size, resizeMode: "contain" }}
      />
    </View>
  );
}
