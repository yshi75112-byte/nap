const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  PROJECT_FORMAT,
  PROJECT_VERSION,
  createBlankDocument,
  ensureProjectExtension,
  normalizeDocument,
  readProject,
  writeProject
} = require("../project-file");

test("writes and reads a versioned .ocmap project", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oc-map-studio-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "world.ocmap");
  const document = {
    regions: [{ id: "region-1", name: "雾港城" }],
    layers: [{ id: "layer-1", regionId: "region-1" }],
    currentViewId: "region-1"
  };

  await writeProject(filePath, document);
  const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
  const restored = await readProject(filePath);

  assert.equal(raw.format, PROJECT_FORMAT);
  assert.equal(raw.version, PROJECT_VERSION);
  assert.match(raw.savedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(restored, document);
});

test("accepts an early unwrapped document", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oc-map-studio-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "legacy.ocmap");
  const document = createBlankDocument();
  await fs.writeFile(filePath, JSON.stringify(document), "utf8");

  assert.deepEqual(await readProject(filePath), document);
});

test("replaces an existing project without leaving temporary files", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oc-map-studio-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "autosave.ocmap");
  const first = createBlankDocument();
  const second = {
    regions: [{ id: "region-latest" }],
    layers: [],
    currentViewId: null
  };

  await writeProject(filePath, first);
  await writeProject(filePath, second);

  assert.deepEqual(await readProject(filePath), second);
  assert.deepEqual(await fs.readdir(directory), ["autosave.ocmap"]);
});

test("rejects unsupported future project versions", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oc-map-studio-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "future.ocmap");
  await fs.writeFile(filePath, JSON.stringify({
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION + 1,
    data: createBlankDocument()
  }), "utf8");

  await assert.rejects(readProject(filePath), /更新版本/);
});

test("normalizes invalid view state and validates document arrays", () => {
  const document = normalizeDocument({
    regions: [],
    layers: [],
    currentViewId: "missing"
  });

  assert.equal(document.currentViewId, null);
  assert.throws(() => normalizeDocument({ regions: [] }), /缺少地域或图层/);
  assert.equal(ensureProjectExtension("world"), "world.ocmap");
  assert.equal(ensureProjectExtension("world.OCMAP"), "world.OCMAP");
});
