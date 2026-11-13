# 贡献

## 拉取请求

用简体中文写 PR 说明。面向用户的变化放在 `## 更新说明` 里；这一节会在发版时写进 Release 正文。没有用户能感知的变化时，写「无用户可见变化」。

## 发布桌面端

合并到 `main` 只跑持续集成：测试、服务端镜像检查，以及 Linux 桌面构建。版本号不会自动增加，也不会发布 GitHub Release。

发布由人手动触发，流水线仍会：

- 读取最新的 `vX.Y.Z` 标签，把补丁号加一，写进桌面端的版本号
- 构建 macOS（Intel 和 Apple 芯片）、Windows、Linux 四个安装包
- 汇总自上一正式版以来所有已合并 PR 的「更新说明」
- 创建 Release，并上传自动更新用的 `latest.json`

在 GitHub 上：Actions → CI → Run workflow → 分支选 `main`。

命令行：

```bash
gh workflow run ci.yml --ref main
```

推送一个已经存在的 `v*` 标签会按这个标签再发布一次，不会在这个版本号上再加一。日常发版用上面的手动运行即可。
