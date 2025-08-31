# --- Stage 1: "builder" - Construye la aplicación Node.js ---
    FROM node:21-alpine3.18 as builder

    WORKDIR /app
    
    # Habilita pnpm
    RUN corepack enable && corepack prepare pnpm@latest --activate
    ENV PNPM_HOME=/usr/local/bin
    
    # Copia los archivos de manifiesto
    COPY package*.json *-lock.yaml ./
    
    # Instala las dependencias de construcción (incluyendo las del SDK de MCP)
    RUN apk add --no-cache --virtual .gyp \
            python3 \
            make \
            g++ \
        && apk add --no-cache git \
        && pnpm install
    
    # Copia el resto del código fuente
    COPY . .
    
    # Compila el proyecto TypeScript
    RUN pnpm run build
    
    # Elimina las dependencias de construcción para mantener la imagen limpia
    RUN apk del .gyp
    
    
    # --- Stage 2: "deploy" - Crea la imagen final de producción ---
    FROM node:21-alpine3.18 as deploy
    
    WORKDIR /app
    
    # Habilita pnpm
    RUN corepack enable && corepack prepare pnpm@latest --activate 
    ENV PNPM_HOME=/usr/local/bin
    
    # --- ¡AQUÍ ESTÁ LA ADICIÓN CLAVE! ---
    # Instala Python, pip y la herramienta postgres-mcp.
    # Esto es necesario en la imagen final porque nuestro bot lo lanzará como un subproceso.
    RUN apk add --no-cache python3 py3-pip
    RUN pip3 install crystal-dba-mcp-server-pro
    # --- FIN DE LA ADICIÓN ---
    
    
    # Copia los artefactos de la etapa de construcción
    COPY --from=builder /app/dist ./dist
    COPY --from=builder /app/*.json /app/*-lock.yaml ./
    
    # Instala solo las dependencias de producción
    RUN pnpm install --production --ignore-scripts
    
    # Crea un usuario no-root para mayor seguridad
    RUN addgroup -g 1001 -S nodejs && adduser -S -u 1001 nodejs
    USER nodejs
    
    # Expone el puerto que Railway usará
    EXPOSE 3008
    
    # Comando de inicio
    CMD ["npm", "start"]