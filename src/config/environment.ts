// src/config/environment.ts
import 'dotenv/config';

export const env = {
    port: parseInt(process.env.PORT ?? '3008', 10),
    myPhoneNumber: process.env.MY_PHONE_NUMBER ?? '',
    openRouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
    
    // Esencial para que el bot sepa a dónde enviar las consultas SQL.
    mcpServerUrl: process.env.MCP_SERVER_URL, 
    
    // Usamos directamente la URL de conexión para la DB de BuilderBot.
    databaseUrl: process.env.DATABASE_URL,
};

// Validación final y robusta, incluyendo mcpServerUrl
if (
    !env.myPhoneNumber || 
    !env.openRouterApiKey || 
    !env.databaseUrl || 
    !env.mcpServerUrl
) {
    throw new Error('Faltan variables de entorno críticas. Asegúrate de que MY_PHONE_NUMBER, OPENROUTER_API_KEY, DATABASE_URL, y MCP_SERVER_URL estén definidas.');
}