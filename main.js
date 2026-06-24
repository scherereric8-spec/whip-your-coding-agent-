const {
  app,
  BrowserWindow,
  ipcMain,
  screen,
  Tray,
  Menu,
  globalShortcut,
  nativeImage,
  desktopCapturer,
} = require("electron");
const path = require("path");

app.setPath("userData", path.join(__dirname, ".data"));

let win = null;
let tray = null;
let visible = true;
let capturingScreen = false;

const HOTKEY = "CommandOrControl+Shift+W";

function trayIcon() {
  const s = 16;
  const buf = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = (y * s + x) * 4;
      const on = x > 3 && x < 12 && y > 1 && y < 14;
      buf[i] = on ? 245 : 0;
      buf[i + 1] = on ? 158 : 0;
      buf[i + 2] = on ? 11 : 0;
      buf[i + 3] = on ? 255 : 0;
    }
  }
  return nativeImage.createFromBuffer(buf, { width: s, height: s });
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: visible ? "Hide overlay" : "Show overlay", click: toggle },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
}

function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(trayMenu());
  tray.setToolTip(visible ? "CrackGPT Whip (visible)" : "CrackGPT Whip (hidden)");
}

function setVisible(on) {
  if (!win) return;
  visible = on;
  if (on) {
    win.show();
    win.setOpacity(1);
  } else {
    win.hide();
  }
  win.webContents.send("visibility", visible);
  refreshTray();
}

function toggle() {
  setVisible(!visible);
}

function restoreWindow() {
  if (!win) return;
  win.setOpacity(1);
  if (visible) win.show();
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().bounds;

  win = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    fullscreen: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    focusable: true,
    show: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, "index.html"));

  win.once("ready-to-show", () => {
    win.show();
    win.setOpacity(1);
    visible = true;
  });

  win.on("closed", () => {
    win = null;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      setVisible(true);
      win.focus();
    }
  });

  app.whenReady().then(() => {
    createWindow();
    tray = new Tray(trayIcon());
    tray.on("double-click", toggle);
    refreshTray();
    globalShortcut.register(HOTKEY, toggle);
  });
}

ipcMain.on("ignore-mouse", (_e, ignore) => {
  if (!win) return;
  win.setIgnoreMouseEvents(ignore, ignore ? { forward: true } : undefined);
});

ipcMain.handle("capture-beneath", async () => {
  if (!win || capturingScreen) return null;
  capturingScreen = true;
  const wasVisible = win.isVisible();

  try {
    win.hide();
    await new Promise((r) => setTimeout(r, 60));

    const display = screen.getPrimaryDisplay();
    const scale = display.scaleFactor;
    const { width, height } = display.bounds;

    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: {
        width: Math.round(width * scale),
        height: Math.round(height * scale),
      },
    });

    const match =
      sources.find((s) => s.display_id === String(display.id)) || sources[0];
    if (!match) return null;

    const size = match.thumbnail.getSize();
    return {
      dataUrl: match.thumbnail.toDataURL(),
      width: size.width,
      height: size.height,
    };
  } catch (err) {
    console.error("capture-beneath failed:", err);
    return null;
  } finally {
    capturingScreen = false;
    if (wasVisible && visible) {
      win.show();
      win.setOpacity(1);
    } else {
      restoreWindow();
    }
  }
});

ipcMain.on("quit", () => app.quit());

app.on("will-quit", () => globalShortcut.unregisterAll());
app.on("window-all-closed", () => app.quit());