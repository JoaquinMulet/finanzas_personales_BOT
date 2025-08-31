// src/config/environment.ts
import 'dotenv/config';

export const env = {
    port: parseInt(process.env.PORT ?? '3008', 10),
    myPhoneNumber: process.env.MY_PHONE_NUMBER ?? '',
    openRouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
    
    // ¡CORRECCIÓN DEFINITIVA!
    // Leemos las variables de entorno estándar de PostgreSQL
    // que Railway proporciona automáticamente.
    db: {
        host: process.env.PGHOST,
        user: process.env.PGUSER,
        database: process.env.PGDATABASE,
        password: process.env.PGPASSWORD,
        port: parseInt(process.env.PGPORT ?? '5432', 10),
    },
};

// Validación final y robusta
if (!env.myPhoneNumber || !env.openRouterApiKey) {
    throw new Error('Faltan variables de entorno críticas: MY_PHONE_NUMBER o OPENROUTER_API_KEY.');
}

if (!env.db.host || !env.db.user || !env.db.database || !env.db.password || !env.db.port) {
    throw new Error('Faltan variables de entorno de la base de datos (PGHOST, PGUSER, PGDATABASE, PGPASSWORD, PGPORT).');
}