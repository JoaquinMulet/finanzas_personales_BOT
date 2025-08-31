# --- Stage 1: Construir el Entorno de Python con postgres-mcp ---
    FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim AS python_builder

    # Instala dependencias del sistema necesarias para psycopg3 (el driver de postgres)
    RUN apt-get update && apt-get install -y libpq-dev gcc && rm -rf /var/lib/apt/lists/*
    
    # Clona el repositorio oficial de postgres-mcp
    RUN git clone https://github.com/crystaldba/postgres-mcp.git /app/postgres-mcp
    
    WORKDIR /app/postgres-mcp
    
    # Instala las dependencias de postgres-mcp en un entorno virtual
    RUN uv venv /opt/venv_python
    RUN . /opt/venv_python/bin/activate && uv sync --frozen --no-dev
    
    
    # --- Stage 2: Construir la Aplicación de Node.js (Tu Dockerfile original) ---
    FROM node:21-alpine3.18 as node_builder
    
    WORKDIR /app
    
    RUN corepack enable && corepack prepare pnpm@latest --activate
    ENV PNPM_HOME=/usr/local/bin
    
    COPY package*.json *-lock.yaml ./
    
    # Instala dependencias de Node
    RUN apk add --no-cache --virtual .gyp python3 make g++ && apk add --no-cache git
    RUN pnpm install
    
    COPY . .
    
    RUN pnpm run build
    RUN apk del .gyp
    
    
    # --- Stage 3: Crear la Imagen Final Combinada ---
    FROM node:21-alpine3.18
    
    WORKDIR /app
    
    # Instala dependencias de sistema necesarias en la imagen final (Python y Git)
    RUN apk add --no-cache python3 py3-pip git
    
    # Copia el entorno virtual de Python con postgres-mcp ya instalado
    COPY --from=python_builder /opt/venv_python /opt/venv_python
    
    # Copia los artefactos de la aplicación Node.js
    COPY --from=node_builder /app/dist ./dist
    COPY --from=node_builder /app/*.json /app/*-lock.yaml ./
    COPY --from=node_builder /app/node_modules ./node_modules
    
    # Establece la ruta de ejecución para que encuentre tanto los binarios de Node como los de Python
    ENV PATH="/opt/venv_python/bin:/app/node_modules/.bin:${PATH}"
    
    # Crea y usa un usuario no-root para mayor seguridad
    RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 nodejs
    USER nodejs
    
    # Expone el puerto que tu app usará
    EXPOSE 3008
    
    # Comando de inicio
    CMD ["npm", "start"]