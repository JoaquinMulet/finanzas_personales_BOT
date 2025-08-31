# Image size ~ 400MB
FROM node:21-alpine3.18 as builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate
ENV PNPM_HOME=/usr/local/bin

# NOTA: He movido el COPY . . más abajo para una mejor optimización de caché.
COPY package*.json *-lock.yaml ./

RUN apk add --no-cache --virtual .gyp \
        python3 \
        make \
        g++ \
    && apk add --no-cache git \
    && pnpm install

# Ahora copiamos el resto del código
COPY . .
RUN pnpm run build \
    && apk del .gyp

FROM node:21-alpine3.18 as deploy

WORKDIR /app

ARG PORT
ENV PORT $PORT
EXPOSE $PORT

# --- ¡AQUÍ ESTÁ LA ADICIÓN CLAVE! ---
# Instala el runtime de Python y pip en la imagen final.
RUN apk add --no-cache python3 py3-pip
# Instala la herramienta postgres-mcp usando pip.
# El nombre correcto del paquete en PyPI es "crystal-dba-mcp-server-pro".
RUN pip3 install crystal-dba-mcp-server-pro
# --- FIN DE LA ADICIÓN ---


COPY --from=builder /app/assets ./assets
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/*.json /app/*-lock.yaml ./

RUN corepack enable && corepack prepare pnpm@latest --activate
ENV PNPM_HOME=/usr/local/bin

# NOTA: No necesitamos "npm cache clean" con pnpm.
# Y pnpm install ya se hizo en la etapa de builder, pero lo hacemos de nuevo
# para asegurarnos de que solo las de producción están.
RUN pnpm install --production --ignore-scripts \
    && addgroup -g 1001 -S nodejs && adduser -S -u 1001 nodejs

# Cambiamos al usuario no-root
USER nodejs

CMD ["npm", "start"]