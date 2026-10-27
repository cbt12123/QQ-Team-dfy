ARG BASE_IMAGE=nvidia/cuda:12.4.1-base-ubuntu22.04
FROM ${BASE_IMAGE}

WORKDIR /app
RUN if ! command -v python3 >/dev/null 2>&1; then \
      apt-get update && \
      DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        python3 python3-pip && \
      rm -rf /var/lib/apt/lists/*; \
    fi

COPY wheels/ /tmp/wheels/
RUN if ls /tmp/wheels/*.whl >/dev/null 2>&1; then \
      python3 -m pip install --no-cache-dir /tmp/wheels/*.whl \
        -i https://pypi.tuna.tsinghua.edu.cn/simple \
        numpy pyyaml fastapi uvicorn pypinyin; \
    else \
      python3 -m pip install --no-cache-dir \
        -i https://pypi.tuna.tsinghua.edu.cn/simple \
        onnxruntime-gpu==1.21.0 numpy pyyaml fastapi uvicorn pypinyin; \
    fi

COPY server.py /app/server.py

ENV SVS_MODEL_DIR=/models/qixuan/Qixuan_v2.7.0_DiffSinger_OpenUtau \
    SVS_VOCODER=/models/vocoder/pc_nsf_hifigan_44.1k_hop512_128bin_2025.02.onnx \
    SVS_STEPS=20 \
    SVS_DEPTH=0.6

EXPOSE 8765
CMD ["python3", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8765"]
