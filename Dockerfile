# Usamos una imagen base de Node.js completa y estable (Debian Bullseye)
FROM node:18-bullseye

# Instala las dependencias de sistema necesarias para Baileys Y Python/pip
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

# Instala la herramienta MCP de Crystal DBA globalmente usando pip
# Este es el nombre correcto del paquete en PyPI
RUN pip3 install crystal-dba-mcp-server-pro

# Establece el directorio de trabajo
WORKDIR /app

# Copia los archivos de manifiesto
COPY package*.json ./

# Instala las dependencias de Node.js
# Usamos pnpm porque es lo que tienes en tu proyecto.
# Primero instalamos pnpm globalmente.
RUN npm install -g pnpm
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