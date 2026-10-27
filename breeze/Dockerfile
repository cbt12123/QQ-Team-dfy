ARG BASE_IMAGE=pytorch/pytorch:2.9.1-cuda12.8-cudnn9-runtime
FROM ${BASE_IMAGE}

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    TOKENIZERS_PARALLELISM=false

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libsndfile1 \
        ffmpeg \
        sox \
        ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ARG PIP_PROXY=""
WORKDIR /app
COPY wheels/ /tmp/wheels/
RUN if ls /tmp/wheels/torch-*.whl >/dev/null 2>&1; then \
      python3 -m pip install --no-cache-dir ${PIP_PROXY:+--proxy "$PIP_PROXY"} \
        /tmp/wheels/torch-*.whl /tmp/wheels/torchaudio-*.whl; \
    fi

COPY requirements-runtime.txt /tmp/requirements-runtime.txt
RUN python3 -m pip install --no-cache-dir ${PIP_PROXY:+--proxy "$PIP_PROXY"} \
        -r /tmp/requirements-runtime.txt -i https://pypi.tuna.tsinghua.edu.cn/simple \
    && python3 -m pip install --no-cache-dir --no-deps \
        ${PIP_PROXY:+--proxy "$PIP_PROXY"} qwen-tts==0.1.1 \
        -i https://pypi.tuna.tsinghua.edu.cn/simple

COPY breeze-tts/ /app/

ENV BREEZE_MODEL=/models/breeze-tts-2
EXPOSE 7860
CMD ["python3", "-m", "breeze_infer.api", "/models/breeze-tts-2", "--host", "0.0.0.0", "--port", "7860"]
