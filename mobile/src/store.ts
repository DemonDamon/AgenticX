import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * 绑定态持久化（expo-secure-store）。
 *
 * 注意：expo-secure-store 的 web 实现是空壳（导出空对象，调用即 TypeError），
 * web 平台降级用 localStorage —— 仅影响 web 调试场景，原生端始终走 Keychain/Keystore。
 */

const KEY_INSTALL_ID = "agx.install_id";
const KEY_GATEWAY_BASE = "agx.gateway_base";
const KEY_DEVICE_ID = "agx.device_id";
const KEY_MOBILE_TOKEN = "agx.mobile_token";

export interface Binding {
  gateway_base: string;
  device_id: string;
  mobile_token: string;
}

async function kvGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") {
    return window.localStorage.getItem(key);
  }
  return await SecureStore.getItemAsync(key);
}

async function kvSet(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") {
    window.localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function kvDelete(key: string): Promise<void> {
  if (Platform.OS === "web") {
    window.localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

/** install_id 只是安装标识（非密钥），Math.random 足够；真正的凭据是 mobile_token。 */
function uuidv4(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 首次调用生成 install_id 并落盘，之后复用。 */
export async function getInstallId(): Promise<string> {
  const existing = await kvGet(KEY_INSTALL_ID);
  if (existing !== null && existing.length > 0) return existing;
  const id = uuidv4();
  await kvSet(KEY_INSTALL_ID, id);
  return id;
}

/** 三项齐全才算已绑定，任何一项缺失视为未绑定。 */
export async function getBinding(): Promise<Binding | null> {
  const [gatewayBase, deviceId, mobileToken] = await Promise.all([
    kvGet(KEY_GATEWAY_BASE),
    kvGet(KEY_DEVICE_ID),
    kvGet(KEY_MOBILE_TOKEN),
  ]);
  if (gatewayBase === null || deviceId === null || mobileToken === null) return null;
  return {
    gateway_base: gatewayBase,
    device_id: deviceId,
    mobile_token: mobileToken,
  };
}

export async function saveBinding(binding: Binding): Promise<void> {
  await Promise.all([
    kvSet(KEY_GATEWAY_BASE, binding.gateway_base),
    kvSet(KEY_DEVICE_ID, binding.device_id),
    kvSet(KEY_MOBILE_TOKEN, binding.mobile_token),
  ]);
}

export async function clearBinding(): Promise<void> {
  await Promise.all([
    kvDelete(KEY_GATEWAY_BASE),
    kvDelete(KEY_DEVICE_ID),
    kvDelete(KEY_MOBILE_TOKEN),
  ]);
}
