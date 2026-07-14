const fs = require("node:fs/promises");

const PROJECT_FORMAT = "oc-map-studio";
const PROJECT_VERSION = 1;

function createBlankDocument() {
  return {
    regions: [],
    layers: [],
    currentViewId: null
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeDocument(value) {
  if (!value || typeof value !== "object") {
    throw new Error("项目内容无效。");
  }

  const regions = Array.isArray(value.regions) ? value.regions : null;
  const layers = Array.isArray(value.layers) ? value.layers : null;
  if (!regions || !layers) {
    throw new Error("项目缺少地域或图层数据。");
  }

  const document = {
    regions: cloneJson(regions),
    layers: cloneJson(layers),
    currentViewId: typeof value.currentViewId === "string" ? value.currentViewId : null
  };

  if (document.currentViewId && !document.regions.some((region) => region.id === document.currentViewId)) {
    document.currentViewId = null;
  }

  return document;
}

function wrapProject(document) {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    data: normalizeDocument(document)
  };
}

async function writeProject(filePath, document) {
  const contents = `${JSON.stringify(wrapProject(document), null, 2)}\n`;
  const temporaryPath = `${filePath}.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
  try {
    await fs.writeFile(temporaryPath, contents, "utf8");
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

async function readProject(filePath) {
  const contents = await fs.readFile(filePath, "utf8");
  let parsed;

  try {
    parsed = JSON.parse(contents);
  } catch (_error) {
    throw new Error("文件不是有效的 OC Map Studio 项目。");
  }

  if (parsed.format === PROJECT_FORMAT) {
    if (!Number.isInteger(parsed.version) || parsed.version < 1) {
      throw new Error("项目文件缺少有效的版本号。");
    }
    if (parsed.version > PROJECT_VERSION) {
      throw new Error(`该项目由更新版本创建（文件版本 ${parsed.version}，当前支持 ${PROJECT_VERSION}）。`);
    }
    return normalizeDocument(parsed.data);
  }

  // Accept an early raw document shape so development builds remain easy to migrate.
  if (Array.isArray(parsed.regions) && Array.isArray(parsed.layers)) {
    return normalizeDocument(parsed);
  }

  throw new Error("无法识别这个项目文件。");
}

function ensureProjectExtension(filePath) {
  return filePath.toLowerCase().endsWith(".ocmap") ? filePath : `${filePath}.ocmap`;
}

module.exports = {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  cloneJson,
  createBlankDocument,
  ensureProjectExtension,
  normalizeDocument,
  readProject,
  wrapProject,
  writeProject
};
