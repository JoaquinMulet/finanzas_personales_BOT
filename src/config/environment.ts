// src/config/environment.ts
import 'dotenv/config';
import { parse as parsePgConnectionString } from 'pg-connection-string';

// Función para obtener la configuración de la base de datos
const getDbConfig = () => {
    const dbUrl = process.env.DATABASE_URL;

    if (dbUrl) {
        // Si DATABASE_URL existe (como en Railway), la parseamos
        console.log('🔌 Usando DATABASE_URL para la conexión a la base de datos.');
        const config = parsePgConnectionString(dbUrl);
        return {
            host: config.host ?? 'localhost',
            user: config.user ?? 'postgres',
            database: config.database ?? 'bbuilderbot',
            password: config.password ?? 'admin',
            port: parseInt(config.port ?? '5432', 10),
        };
    } else {
        // Si no, usamos las variables individuales (para desarrollo local)
        console.log('🔧 Usando variables de entorno individuales para la base de datos.');
        return {
            host: process.env.POSTGRES_DB_HOST ?? 'localhost',
            user: process.env.POSTGRES_DB_USER ?? 'postgres',
            database: process.env.POSTGRES_DB_NAME ?? 'bbuilderbot',
            password: process.env.POSTGRES_DB_PASSWORD ?? 'admin',
            port: parseInt(process.env.POSTGRES_DB_PORT ?? '5432', 10),
        };
    }
};

export const env = {
    port: parseInt(process.env.PORT ?? '3008', 10),
    myPhoneNumber: process.env.MY_PHONE_NUMBER ?? '',
    openRouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
    mcpServerUrl: process.env.MCP_SERVER_URL ?? '',
    db: getDbConfig(), // Llamamos a nuestra nueva función
};

// Simple validation
if (!env.myPhoneNumber || !env.openRouterApiKey) {
    throw new Error('Missing critical environment variables: MY_PHONE_NUMBER or OPENROUTER_API_KEY');
}