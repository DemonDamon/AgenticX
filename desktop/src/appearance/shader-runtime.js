// Keep the runtime import lazy through ShaderWallpaper. The accompanying narrow
// contract avoids 4.0.4's unrelated, invalid blur declarations leaking into the
// application's type graph (WgslStorageTexture2d<..., string>).
export { Shader, LinearGradient, getWebGPUSupport } from "shaders/react";
