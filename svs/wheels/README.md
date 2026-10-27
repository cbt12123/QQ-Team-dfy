# 本地放置 ONNX Runtime CUDA wheel（可选，构建时会优先使用）

把 `onnxruntime_gpu-1.21.0-cp310-cp310-manylinux_2_27_x86_64.manylinux_2_28_x86_64.whl`
放在这个目录即可。没有 wheel 时，Dockerfile 会从 PyPI 安装 `onnxruntime-gpu==1.21.0`。

wheel 体积约 270MB，不要提交到 Git。
