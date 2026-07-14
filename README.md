# OC Map Studio

OC Map Studio 是一个本地优先的桌面地图编辑器。界面仍然由 `index.html` 提供，Electron 负责窗口、原生文件对话框和 `.ocmap` 项目文件读写。

## 开发

```powershell
npm install
npm run dev
```

开发时不需要反复生成安装包。修改 `index.html` 后，在应用窗口中按 `Ctrl+R` 重新载入即可。

## 项目文件

- 新项目第一次保存时会询问 `.ocmap` 文件位置。
- 保存过一次后，内容变化会自动写回当前文件。
- `Ctrl+S` 手动保存，`Ctrl+Shift+S` 另存为。
- 文件内包含格式标识和版本号，后续数据结构变化可以增加迁移逻辑。
- 未保存项目在新建、打开其他项目或退出前会得到提示。

## Windows 构建

```powershell
# 生成免安装的解包目录，适合阶段测试
npm run pack:win

# 生成 Windows 安装程序
npm run dist:win

# 生成单文件便携版
npm run dist:portable
```

构建结果位于 `dist/`，该目录已被 Git 忽略。
