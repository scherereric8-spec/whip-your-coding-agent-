const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("whip", {
  setIgnoreMouse: (ignore) => ipcRenderer.send("ignore-mouse", ignore),
  quit: () => ipcRenderer.send("quit"),
  onVisibility: (fn) => ipcRenderer.on("visibility", (_e, v) => fn(v)),
  captureBeneath: () => ipcRenderer.invoke("capture-beneath"),
});