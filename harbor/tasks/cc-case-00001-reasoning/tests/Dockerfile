FROM python:3.12-slim-bookworm

WORKDIR /app

COPY grade.py test.sh /tests/
COPY fixtures /tests/fixtures

RUN chmod 755 /tests/test.sh
