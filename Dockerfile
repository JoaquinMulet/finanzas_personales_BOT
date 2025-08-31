# Usamos una base más moderna (Debian Bookworm) que SÍ tiene Python 3.12
FROM node:18-bookworm

# Instala las dependencias de sistema.
# Añadimos 'pipx' a la lista.
RUN apt-get update && apt-get install -y \
    g++ \
    make \
    python3 \
    python3-venv \
    python3-pip \
    pipx \
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

# Asegurarse de que las aplicaciones instaladas con pipx estén en la RUTA del sistema
RUN pipx ensurepath

# Usamos pipx para instalar 'postgres-mcp' de forma segura.
# pipx manejará el entorno virtual por nosotros.
RUN pipx install postgres-mcp


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
# Tenemos que asegurarnos de que la ruta de pipx esté disponible
CMD ["/bin/sh", "-c", "export PATH=$PATH:/root/.local/bin && pnpm start"]