# Usamos una imagen base de Node.js completa y estable (Debian Bullseye)
FROM node:18-bullseye

# Instala las dependencias de sistema necesarias para Baileys, Python y las herramientas de compilación
RUN apt-get update && apt-get install -y \
    g++ \
    make \
    python3 \
    python3-pip \
    git \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libgtk-3-0 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# --- Instalación de la Herramienta MCP con UV (Método Recomendado) ---
# 1. Instala 'uv' usando pip
RUN pip3 install uv

# 2. Usa 'uv' para instalar el paquete 'postgres-mcp' globalmente en el sistema.
#    Añadimos el flag --system para cumplir con los requerimientos de uv.
RUN uv pip install postgres-mcp --system
# --- Fin de la instalación de MCP ---


# Establece el directorio de trabajo para la aplicación de Node.js
WORKDIR /app

# Copia los archivos de manifiesto
COPY package*.json ./

# Instala pnpm globalmente
RUN npm install -g pnpm

# Instala las dependencias de Node.js
RUN pnpm install

# Copia el resto del código de la aplicación
COPY . .

# Compila el código TypeScript a JavaScript
RUN pnpm run build

# Expone el puerto que tu app usará
EXPOSE 3008

# Crea y usa un usuario no-root por seguridad
RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 nodejs
USER nodejs

# Comando final para iniciar el bot
CMD ["pnpm", "start"]