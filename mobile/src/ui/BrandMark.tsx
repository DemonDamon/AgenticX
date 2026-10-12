import { Image, ImageStyle, StyleProp, View } from "react-native";
import { brand } from "./theme";

/**
 * Near 品牌 Mark：橙色立方体（透明底 PNG，源自 desktop 同源资产）。
 * 可选奶油色圆形底托，用于需要承载感的场景（启动区、空状态）。
 */
export function BrandMark({
  size = 72,
  plated = false,
  style,
}: {
  size?: number;
  plated?: boolean;
  style?: StyleProp<ImageStyle>;
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
      style={{
        width: plate,
        height: plate,
        borderRadius: plate / 2,
        backgroundColor: brand.creamDeep,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Image
        source={require("../../assets/brand/near-box.png")}
        style={{ width: size, height: size, resizeMode: "contain" }}
      />
    </View>
  );
}
