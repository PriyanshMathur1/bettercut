# BetterCut Cloud: API + job worker + editor UI + renderer in one image.
# Builds on arm64 (Oracle Ampere, Hetzner CAX) and amd64. Build from the repo root:
#   docker build -f bettercut/deploy/Dockerfile -t bettercut .
FROM node:24-bookworm-slim AS ui
WORKDIR /app/composer
COPY composer/package.json composer/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY composer/ ./
RUN npx vite build --config editor/vite.config.ts

FROM python:3.11-slim-bookworm
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HOME=/opt/models/hf TORCH_HOME=/opt/models/torch NLTK_DATA=/opt/models/nltk \
    HOME=/home/bettercut BETTERCUT_DATA=/data LITELLM_LOCAL_MODEL_COST_MAP=True

# ffmpeg for media; the libraries below are what Remotion's headless Chrome needs
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg ca-certificates curl tini \
      libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libasound2 libxrandr2 libxkbcommon0 \
      libxfixes3 libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 libcups2 fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ui /usr/local/bin/node /usr/local/bin/node
COPY --from=ui /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

WORKDIR /app
COPY requirements.txt /tmp/requirements.txt
# CPU-only torch keeps the image ~2 GB smaller than the default CUDA build on amd64
RUN pip install --extra-index-url https://download.pytorch.org/whl/cpu -r /tmp/requirements.txt

RUN useradd --create-home --home-dir /home/bettercut --uid 10001 bettercut \
    && mkdir -p /data /opt/models && chown -R bettercut /data /opt/models /app
USER bettercut

COPY --chown=bettercut bettercut/ ./bettercut/
COPY --chown=bettercut --from=ui /app/composer ./composer

# Bake in everything a first job would otherwise download: Whisper small, the English alignment model,
# the sentence splitter, the face model, sound effects, colour LUTs and Remotion's Chrome.
ARG WHISPER_MODEL=small
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('${WHISPER_MODEL}', device='cpu', compute_type='int8')" \
    && python -c "import whisperx; whisperx.load_align_model(language_code='en', device='cpu')" \
    && python -c "import nltk; nltk.download('punkt_tab', quiet=True)" \
    && python -c "from bettercut.vision import _yunet; assert _yunet() is not None" \
    && python -c "from bettercut.sfx_gen import generate; from bettercut.colour import ensure_luts; generate(); ensure_luts()" \
    && cd composer && npx remotion browser ensure

ENV WHISPER_MODEL=${WHISPER_MODEL}
VOLUME /data
EXPOSE 4790
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD curl -fsS http://127.0.0.1:4790/api/health || exit 1
ENTRYPOINT ["tini", "--"]
CMD ["python", "-m", "bettercut", "cloud", "--host", "0.0.0.0", "--port", "4790"]
