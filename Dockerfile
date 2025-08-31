# Image size ~ 400MB
FROM node:21-alpine3.18 as builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate
ENV PNPM_HOME=/usr/local/bin

COPY package*.json *-lock.yaml ./

# Instala dependencias de build, incluyendo git, python y make
RUN apk add --no-cache --virtual .gyp \
        python3 \
        make \
        g++ \
    && apk add --no-cache git \
    && pnpm install

COPY . .

RUN pnpm run build \
    && apk del .gyp


FROM node:21-alpine3.18 as deploy

WORKDIR /app

# --- ¡AQUÍ ESTÁ LA ADICIÓN CLAVE Y CORRECTA! ---
# 1. Instala las dependencias de sistema necesarias en la imagen final
RUN apk add --no-cache git python3 py3-pip

# 2. Clona el repositorio oficial de postgres-mcp
RUN git clone https://github.com/crystaldba/postgres-mcp.git /opt/postgres-mcp

# 3. Instala las dependencias de postgres-mcp usando uv (su método preferido)
# Esto crea un entorno virtual en /opt/venv_python
WORKDIR /opt/postgres-mcp
RUN pip3 install uv
RUN uv venv /opt/venv_python
RUN . /opt/venv_python/bin/activate && uv sync --frozen --no-dev
# --- FIN DE LA ADICIÓN ---


# Vuelve al directorio de trabajo de nuestra aplicación
WORKDIR /app

ARG PORT
ENV PORT $PORT
EXPOSE $PORT

# Copia los artefactos de la aplicación Node.js desde la etapa 'builder'
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json /app/*-lock.yaml ./

RUN corepack enable && corepack prepare pnpm@latest --activate 
ENV PNPM_HOME=/usr/local/bin

RUN pnpm install --production --ignore-scripts \
    && addgroup -g 1001 -S nodejs && adduser -S -u 1001 nodejs

USER nodejs

CMD ["pnpm", "start"]