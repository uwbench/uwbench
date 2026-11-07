FROM python:3.12-slim-bookworm

RUN useradd --create-home --uid 1000 --shell /bin/bash agent \
    && mkdir -p /app \
    && chown agent:agent /app

WORKDIR /app

COPY --chown=agent:agent case/ /app/case/
