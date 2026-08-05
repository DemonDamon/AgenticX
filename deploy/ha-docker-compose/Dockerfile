# Minimal agx serve image for HA validation (dev/validation only, not the
# production packaging path — see packaging/ for DMG/PyInstaller builds).
FROM python:3.12-slim

WORKDIR /app
COPY . /app

RUN pip install --no-cache-dir -e . \
    && pip install --no-cache-dir "redis>=5.0.0,<6"

ENV HOME=/data
EXPOSE 8000

CMD ["sh", "-c", "agx serve --host 0.0.0.0 --port ${AGX_PORT:-8000}"]
