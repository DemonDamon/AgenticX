import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing, StyleProp, View, ViewStyle } from "react-native";

/**
 * 会动的 Near 品牌 Mark：移植自桌面端 NearBoxHero 的待机动态效果——
 * 整体呼吸浮动、眼睛随机眨眼、眼神缓慢游走。
 * 方块脸与两只眼睛分层渲染（脸为无眼 PNG，眼睛为独立白色椭圆），
 * 坐标沿用桌面端 160×160 viewBox 的标定值。
 */

// 桌面端标定的脸部坐标（viewBox 160×160），两只眼睛中心点
const FACE_LEFT = { cx: 106, cy: 104 } as const;
const FACE_RIGHT = { cx: 128, cy: 92 } as const;
// 眼型：圆短椭圆，随立方体右侧面透视左倾（左眼更斜）
const EYE_RX = 6.0;
const EYE_RY = 10.2;
const EYES = [
  { face: FACE_LEFT, rotate: -14 },
  { face: FACE_RIGHT, rotate: -6 },
] as const;
// 无眼脸 PNG 在 viewBox 中的摆放盒（与桌面 LOGO_MARK_BOX 一致）
const MARK_BOX = { x: 13.4, y: 8, width: 133.2, height: 144 } as const;

const BREATHE_MS = 1700; // 单程，桌面 3.4s 一个完整周期
const BLINK_WAIT: readonly [number, number] = [6000, 14000];
const GAZE_WANDER_WAIT: readonly [number, number] = [1200, 2400];
const GAZE_RANGE = 3; // viewBox 单位

function randIn([lo, hi]: readonly [number, number]): number {
  return lo + Math.random() * (hi - lo);
}

export function AnimatedBrandMark({
  size = 96,
  style,
}: {
  size?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const k = size / 160; // viewBox → 实际像素换算
  const breathe = useRef(new Animated.Value(0)).current;
  const lid = useRef(new Animated.Value(1)).current;
  const gazeX = useRef(new Animated.Value(0)).current;
  const gazeY = useRef(new Animated.Value(0)).current;
  const [still, setStill] = useState(false);

  // 减弱动态效果偏好：退化为完全静止
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setStill);
  }, []);

  // 呼吸：translateY -2px + 轻微拉伸（对应桌面 near-box-breathe）
  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: BREATHE_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: BREATHE_MS,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [still, breathe]);

  // 眨眼：随机间隔闭合再睁开，14% 概率连眨两下（与桌面 blink 节奏一致）
  useEffect(() => {
    if (still) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const blinkOnce = (done: () => void) => {
      Animated.sequence([
        Animated.timing(lid, { toValue: 0.05, duration: 150, useNativeDriver: true }),
        Animated.timing(lid, { toValue: 1.08, duration: 150, useNativeDriver: true }),
        Animated.timing(lid, { toValue: 1, duration: 150, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) done();
      });
    };
    const schedule = () => {
      if (cancelled) return;
      timer = setTimeout(() => {
        if (cancelled) return;
        blinkOnce(() => {
          if (cancelled) return;
          if (Math.random() < 0.14) {
            timer = setTimeout(() => {
              if (!cancelled) blinkOnce(schedule);
            }, 220);
          } else {
            schedule();
          }
        });
      }, randIn(BLINK_WAIT));
    };
    schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [still, lid]);

  // 眼神游走：rest 情绪下 1.2s–2.4s 换一次注视点
  useEffect(() => {
    if (still) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wander = () => {
      if (cancelled) return;
      timer = setTimeout(() => {
        if (cancelled) return;
        Animated.parallel([
          Animated.timing(gazeX, {
            toValue: (Math.random() * 2 - 1) * GAZE_RANGE,
            duration: 380,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(gazeY, {
            toValue: (Math.random() * 2 - 1) * GAZE_RANGE,
            duration: 380,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]).start(({ finished }) => {
          if (finished) wander();
        });
      }, randIn(GAZE_WANDER_WAIT));
    };
    wander();
    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [still, gazeX, gazeY]);

  const eye = (eyeSpec: (typeof EYES)[number]) => ({
    position: "absolute" as const,
    left: (eyeSpec.face.cx - EYE_RX) * k,
    top: (eyeSpec.face.cy - EYE_RY) * k,
    width: EYE_RX * 2 * k,
    height: EYE_RY * 2 * k,
    borderRadius: EYE_RX * k,
    backgroundColor: "#FFFFFF",
  });

  return (
    <Animated.View
      style={[
        { width: size, height: size },
        still
          ? null
          : {
              transform: [
                {
                  translateY: breathe.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -2],
                  }),
                },
                {
                  scaleX: breathe.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 1.018],
                  }),
                },
                {
                  scaleY: breathe.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1, 0.982],
                  }),
                },
              ],
            },
        style,
      ]}
    >
      <Animated.Image
        source={require("../../assets/brand/near-box-face.png")}
        style={{
          position: "absolute",
          left: MARK_BOX.x * k,
          top: MARK_BOX.y * k,
          width: MARK_BOX.width * k,
          height: MARK_BOX.height * k,
          resizeMode: "contain",
        }}
      />
      {EYES.map((eyeSpec, index) => (
        <Animated.View
          key={index}
          style={[
            eye(eyeSpec),
            {
              transform: still
                ? [{ rotate: `${eyeSpec.rotate}deg` }]
                : [
                    { translateX: gazeX },
                    { translateY: gazeY },
                    { rotate: `${eyeSpec.rotate}deg` },
                    { scaleY: lid },
                  ],
            },
          ]}
        />
      ))}
    </Animated.View>
  );
}
