# 公网网页连通性测试

这个目录是独立的临时测试服务，无第三方依赖，不启动机器人。

本机运行：`node server.mjs`，打开 http://localhost:10000。

Render 部署：将本目录内容作为独立 Git 仓库的根目录上传，再创建 Web Service。

- Instance Type: Free
- Build Command: `node --check server.mjs`
- Start Command: `node server.mjs`
- Health Check Path: `/health`

也可以在独立仓库中使用 render.yaml 创建 Blueprint。
不要上传整个机器人项目或任何 .env 文件。

服务监听 `0.0.0.0` 和环境变量 `PORT`（本地默认 10000）。
Render 通过平台 HTTPS 入口暴露服务，外部使用部署后返回的 https://xxx.onrender.com 访问，无需附带 :10000。

免费实例空闲 15 分钟会休眠，首次重新访问可能需要约一分钟。
