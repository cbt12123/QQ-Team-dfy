# 可选：本地 torch wheel

如果构建时网络较慢，可以把：

- `torch-2.9.1-cp310-cp310-manylinux_2_28_x86_64.whl`
- `torchaudio-2.9.1-cp310-cp310-manylinux_2_28_x86_64.whl`

放到这个目录，Dockerfile 会优先从本地安装。文件较大，不提交到 Git。
