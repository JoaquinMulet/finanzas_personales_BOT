// src/config/environment.ts
import 'dotenv/config';

export const env = {
    port: parseInt(process.env.PORT ?? '3008', 10),
    myPhoneNumber: process.env.MY_PHONE_NUMBER ?? '',
    openRouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
    mcpServerUrl: process.env.MCP_SERVER_URL ?? '',
    
    // ¡SIMPLIFICADO! Usamos directamente la URL de conexión de la base de datos.
    // Esto es más limpio y el estándar en plataformas como Railway.
    databaseUrl: process.env.DATABASE_URL,
};

// Validación final y robusta
if (!env.myPhoneNumber || !env.openRouterApiKey || !env.databaseUrl) {
    throw new Error('Faltan variables de entorno críticas: MY_PHONE_NUMBER, OPENROUTER_API_KEY, o DATABASE_URL.');
}