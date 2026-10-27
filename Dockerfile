FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .
COPY energy_data.db .
COPY january_2026_wind_data.csv .
COPY test_backend.py .

EXPOSE 8000

ENV PORT=8000

# Shell form ensures $PORT is expanded properly by Render / Railway cloud runtimes
CMD sh -c "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"
