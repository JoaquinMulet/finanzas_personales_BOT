// src/services/mcp.service.ts

import { env } from '../config/environment';
import { randomUUID } from 'crypto'; // Usaremos esto para generar IDs de solicitud

/**
 * Representa una respuesta JSON-RPC estándar.
 */
interface JsonRpcResponse {
  jsonrpc: string;
  id: string;
  result?: any;
  error?: {
    code: number;
    message: string;
  };
}

/**
 * Ejecuta una consulta SQL a través del nuevo servidor MCP (@gldc/mcp-postgres).
 * Se comunica a través de HTTP usando el protocolo JSON-RPC.
 *
 * @param query - Una única consulta SQL o un array de ellas para una transacción.
 * @returns Una promesa que resuelve con los datos de la consulta o un objeto de error.
 */
export const executeSql = async (query: string | string[]): Promise<any> => {
    let mcpServerUrl = env.mcpServerUrl;

    if (!mcpServerUrl) {
        console.error('❌ La URL del servidor MCP no está configurada.');
        return { error: 'La conexión con el servicio de base de datos no está configurada.' };
    }
    if (!mcpServerUrl.startsWith('http')) {
        mcpServerUrl = `https://${mcpServerUrl}`;
    }

    // El nuevo servidor usa la herramienta 'run_query_json', que es más robusta.
    // También requiere un formato de payload JSON-RPC.
    const mcpPayload = {
        jsonrpc: "2.0",
        method: "run_query_json", // La herramienta preferida que devuelve JSON
        params: {
            input: {
                // Si es un array, lo unimos en una sola transacción.
                sql: Array.isArray(query) ? query.join('; ') : query,
                row_limit: 1000 // Un límite de seguridad
            }
        },
        id: randomUUID() // Cada solicitud debe tener un ID único
    };
    
    // La documentación indica que el endpoint es /mcp
    const finalUrl = `${mcpServerUrl}/mcp`;

    console.log(`➡️  Enviando llamada a herramienta MCP: ${mcpPayload.method}`);
    
    try {
        const response = await fetch(finalUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mcpPayload),
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Error HTTP del servidor MCP: ${response.status} - ${errorText}`);
            throw new Error(`El servidor de base de datos respondió con un error: ${response.status}`);
        }
        
        const result: JsonRpcResponse = await response.json();

        if (result.error) {
             console.error('❌ Error reportado por el servidor MCP:', result.error);
             return { error: result.error.message };
        }
        
        console.log('⬅️  Respuesta recibida de MCP.');
        // El resultado útil está anidado dentro de result.result.structuredContent
        return result.result?.structuredContent;

    } catch (error) {
        console.error('❌ Fallo la comunicación con el servicio MCP:', error);
        return { error: 'No se pudo conectar con el servicio de base de datos.' };
    }
};