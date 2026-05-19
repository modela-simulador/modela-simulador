FROM python:3.11-slim

WORKDIR /app

# Install system deps for geospatial libs (GEOS, PROJ)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgeos-dev libproj-dev && \
    rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV PORT=8000
EXPOSE ${PORT}

# Render sets PORT dynamically; shell form allows variable expansion
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT} --timeout-keep-alive 120
