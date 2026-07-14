const { app, BrowserWindow, Menu, dialog, ipcMain } = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const {
  cloneJson,
  createBlankDocument,
  ensureProjectExtension,
  normalizeDocument,
  readProject,
  writeProject
} = require("./project-file");

const AUTOSAVE_DELAY_MS = 700;
const smokeTestMode = process.argv.includes("--smoke-test");

let mainWindow = null;
let currentFilePath = null;
let currentDocument = createBlankDocument();
let currentRevision = 0;
let dirty = false;
let autosaveTimer = null;
let projectWriteQueue = Promise.resolve();
let allowWindowClose = false;
let closePromptOpen = false;

function getDisplayName(filePath = currentFilePath) {
  return filePath ? path.basename(filePath, path.extname(filePath)) : "未命名项目";
}

function getProjectMetadata() {
  return {
    filePath: currentFilePath,
    displayName: getDisplayName(),
    dirty,
    revision: currentRevision
  };
}

function updateWindowTitle() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const marker = dirty ? " *" : "";
  mainWindow.setTitle(`${getDisplayName()}${marker} — OC Map Studio`);
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function queueProjectWrite(filePath, document) {
  const operation = projectWriteQueue
    .catch(() => undefined)
    .then(() => writeProject(filePath, document));
  projectWriteQueue = operation;
  return operation;
}

async function chooseProjectSavePath() {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "保存 OC Map Studio 项目",
    defaultPath: `${getDisplayName()}.ocmap`,
    filters: [
      { name: "OC Map Studio 项目", extensions: ["ocmap"] }
    ]
  });

  return result.canceled || !result.filePath ? null : ensureProjectExtension(result.filePath);
}

async function saveCurrentProject({ choosePath = false } = {}) {
  let targetPath = choosePath ? null : currentFilePath;
  if (!targetPath) {
    targetPath = await chooseProjectSavePath();
  }
  if (!targetPath) return false;

  try {
    const savedRevision = currentRevision;
    await queueProjectWrite(targetPath, currentDocument);
    currentFilePath = targetPath;
    if (savedRevision === currentRevision) dirty = false;
    updateWindowTitle();
    sendToRenderer("project:saved", {
      ...getProjectMetadata(),
      revision: savedRevision,
      automatic: false
    });
    return true;
  } catch (error) {
    await dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "保存失败",
      message: "项目没有保存成功。",
      detail: error.message
    });
    return false;
  }
}

function scheduleAutosave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  if (!currentFilePath || !dirty) return;

  autosaveTimer = setTimeout(async () => {
    autosaveTimer = null;
    const savedRevision = currentRevision;
    const documentSnapshot = cloneJson(currentDocument);

    try {
      await queueProjectWrite(currentFilePath, documentSnapshot);
      if (savedRevision === currentRevision) dirty = false;
      updateWindowTitle();
      sendToRenderer("project:saved", {
        ...getProjectMetadata(),
        revision: savedRevision,
        automatic: true
      });
    } catch (error) {
      sendToRenderer("project:error", {
        message: `自动保存失败：${error.message}`
      });
    }
  }, AUTOSAVE_DELAY_MS);
}

async function confirmReplaceProject(actionLabel) {
  if (!dirty) return true;

  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "项目尚未保存",
    message: `当前项目有未保存的修改，是否先保存再${actionLabel}？`,
    buttons: ["保存", "不保存", "取消"],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  });

  if (result.response === 2) return false;
  if (result.response === 0) return saveCurrentProject();
  return true;
}

function replaceCurrentProject(document, filePath = null) {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }
  currentDocument = normalizeDocument(document);
  currentFilePath = filePath;
  currentRevision = 0;
  dirty = false;
  updateWindowTitle();
  return {
    canceled: false,
    document: cloneJson(currentDocument),
    ...getProjectMetadata()
  };
}

function registerIpcHandlers() {
  ipcMain.handle("project:get-initial", () => ({
    document: cloneJson(currentDocument),
    ...getProjectMetadata()
  }));

  ipcMain.handle("project:new", async () => {
    if (!(await confirmReplaceProject("新建项目"))) return { canceled: true };
    return replaceCurrentProject(createBlankDocument());
  });

  ipcMain.handle("project:open", async () => {
    if (!(await confirmReplaceProject("打开其他项目"))) return { canceled: true };

    const result = await dialog.showOpenDialog(mainWindow, {
      title: "打开 OC Map Studio 项目",
      properties: ["openFile"],
      filters: [
        { name: "OC Map Studio 项目", extensions: ["ocmap"] },
        { name: "所有文件", extensions: ["*"] }
      ]
    });

    if (result.canceled || !result.filePaths.length) return { canceled: true };

    try {
      const filePath = result.filePaths[0];
      const document = await readProject(filePath);
      return replaceCurrentProject(document, filePath);
    } catch (error) {
      await dialog.showMessageBox(mainWindow, {
        type: "error",
        title: "无法打开项目",
        message: "这个文件无法作为 OC Map Studio 项目打开。",
        detail: error.message
      });
      return { canceled: true };
    }
  });

  ipcMain.handle("project:save", async (_event, payload) => {
    currentDocument = normalizeDocument(payload.document);
    currentRevision = Number.isInteger(payload.revision) ? payload.revision : currentRevision;
    dirty = true;
    const saved = await saveCurrentProject();
    return { canceled: !saved, ...getProjectMetadata() };
  });

  ipcMain.handle("project:save-as", async (_event, payload) => {
    currentDocument = normalizeDocument(payload.document);
    currentRevision = Number.isInteger(payload.revision) ? payload.revision : currentRevision;
    dirty = true;
    const saved = await saveCurrentProject({ choosePath: true });
    return { canceled: !saved, ...getProjectMetadata() };
  });

  ipcMain.on("project:update-state", (event, payload) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) return;
    try {
      currentDocument = normalizeDocument(payload.document);
      currentRevision = Number.isInteger(payload.revision) ? payload.revision : currentRevision + 1;
      dirty = true;
      updateWindowTitle();
      scheduleAutosave();
    } catch (error) {
      sendToRenderer("project:error", { message: error.message });
    }
  });

  ipcMain.handle("project:export-png", async (_event, payload) => {
    const match = typeof payload.dataUrl === "string"
      ? payload.dataUrl.match(/^data:image\/png;base64,(.+)$/)
      : null;
    if (!match) throw new Error("PNG 数据无效。");

    const safeName = String(payload.suggestedName || getDisplayName())
      .replace(/[<>:\"/\\|?*]/g, "-")
      .trim() || "oc-map";
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "导出 PNG",
      defaultPath: `${safeName}.png`,
      filters: [{ name: "PNG 图片", extensions: ["png"] }]
    });

    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.writeFile(result.filePath, Buffer.from(match[1], "base64"));
    return { canceled: false, filePath: result.filePath };
  });
}

function sendProjectCommand(command) {
  sendToRenderer("project:command", command);
}

function buildApplicationMenu() {
  const template = [
    {
      label: "文件",
      submenu: [
        { label: "新建", accelerator: "CmdOrCtrl+N", click: () => sendProjectCommand("new") },
        { label: "打开…", accelerator: "CmdOrCtrl+O", click: () => sendProjectCommand("open") },
        { type: "separator" },
        { label: "保存", accelerator: "CmdOrCtrl+S", click: () => sendProjectCommand("save") },
        { label: "另存为…", accelerator: "CmdOrCtrl+Shift+S", click: () => sendProjectCommand("save-as") },
        { type: "separator" },
        { role: "quit", label: "退出" }
      ]
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" }
      ]
    },
    {
      label: "视图",
      submenu: [
        { role: "reload", label: "重新载入" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "resetZoom", label: "实际大小" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { role: "togglefullscreen", label: "切换全屏" }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function confirmWindowClose() {
  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "项目尚未保存",
    message: "关闭前是否保存当前项目？",
    buttons: ["保存并退出", "不保存", "取消"],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  });

  if (result.response === 2) return false;
  if (result.response === 0) return saveCurrentProject();
  return true;
}

function createWindow() {
  allowWindowClose = false;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 860,
    minHeight: 560,
    backgroundColor: "#efe1bf",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile("index.html");
  mainWindow.once("ready-to-show", () => mainWindow.show());
  if (smokeTestMode) {
    mainWindow.webContents.once("did-finish-load", async () => {
      try {
        const result = await mainWindow.webContents.executeJavaScript(`
          new Promise((resolve) => window.setTimeout(() => resolve({
            title: document.title,
            hasDesktopApi: Boolean(window.desktopAPI),
            hasProjectControls: ["newProjectButton", "openProjectButton", "saveProjectButton"]
              .every((id) => Boolean(document.getElementById(id))),
            projectStatus: document.getElementById("projectStatus")?.textContent || ""
          }), 150))
        `);
        const passed = result.title === "OC Map Studio"
          && result.hasDesktopApi
          && result.hasProjectControls
          && result.projectStatus.includes("未命名项目");
        console.log(`DESKTOP_SMOKE_TEST ${JSON.stringify(result)}`);
        app.exit(passed ? 0 : 1);
      } catch (error) {
        console.error("DESKTOP_SMOKE_TEST_FAILED", error);
        app.exit(1);
      }
    });
  }
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());
  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    updateWindowTitle();
  });
  updateWindowTitle();

  mainWindow.on("close", async (event) => {
    if (allowWindowClose || !dirty) return;
    event.preventDefault();
    if (closePromptOpen) return;

    closePromptOpen = true;
    const canClose = await confirmWindowClose();
    closePromptOpen = false;
    if (canClose) {
      allowWindowClose = true;
      mainWindow.close();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

registerIpcHandlers();

app.whenReady().then(() => {
  buildApplicationMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
