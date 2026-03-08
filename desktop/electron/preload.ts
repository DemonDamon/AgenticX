import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("agenticxDesktop", {
  version: "0.1.0"
});
