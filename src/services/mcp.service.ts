// src/services/mcp.service.ts

import { env } from '../config/environment';

/**
 * La estructura de la respuesta que probablemente devuelva el MCP Pro
 * cuando se llama a una herramienta. El resultado real estará anidado.
 */
interface MCPToolResponse {
  result: any; // El resultado de la ejecución de la herramienta
  error?: any;
}

/**
 * Ejecuta una consulta SQL a través del servicio seguro Postgres MCP Pro,
 * siguiendo el formato de llamada de herramientas del protocolo MCP.
 *
 * @param query - La cadena de texto de la consulta SQL (o un array de ellas) a ejecutar.
 * @returns Una promesa que resuelve con los datos de la consulta o un objeto de error.
 */
export const executeSql = async (query: string | string[]): Promise<any> => {
    let mcpServerUrl = env.mcpServerUrl;
    // Validamos que la URL del servidor MCP esté configurada
    // 1. Verificamos si la URL base está configurada.
    if (!mcpServerUrl) {
        console.error('❌ La URL del servidor MCP no está configurada en las variables de entorno.');
        return { error: 'La conexión con la base de datos no está configurada.' };
    }

    // 2. Nos aseguramos de que la URL tenga el protocolo https://.
    // Esto nos protege si Railway (o cualquier sistema) lo elimina.
    if (!mcpServerUrl.startsWith('http://') && !mcpServerUrl.startsWith('https://')) {
        console.log(`⚠️ La URL del MCP no tiene protocolo. Añadiendo https:// por defecto.`);
        mcpServerUrl = `https://${mcpServerUrl}`;
    }
    
    // El cuerpo de la solicitud debe especificar la herramienta a usar
    const mcpPayload = {
        tool: "execute_sql",
        payload: {
            query: query
        }
    };

    console.log(`➡️  Enviando llamada a herramienta MCP: ${JSON.stringify(mcpPayload).substring(0, 150)}...`);

    try {
        // CORRECCIÓN FINAL: Añadimos "/sse" al final de la URL del servidor.
        const response = await fetch(`${env.mcpServerUrl}/sse`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(mcpPayload),
        });

        // Manejo de errores de HTTP (ej. 404, 500)
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`❌ Error HTTP del servidor MCP: ${response.status} - ${errorText}`);
            throw new Error(`El servidor de base de datos respondió con un error: ${response.status}`);
        }

        const result: MCPToolResponse = await response.json();

        // Manejo de errores lógicos devueltos por la API del MCP
        if (result.error) {
            console.error(`❌ Error en la ejecución de la herramienta reportado por MCP:`, result.error);
            return { error: result.error || 'Error desconocido al ejecutar la consulta.' };
        }
        
        console.log(`⬅️  Respuesta recibida de MCP.`);
        // CORRECCIÓN: Devolvemos la propiedad 'result' que contiene los datos.
        return result.result;

    } catch (error) {
        console.error('❌ Fallo la comunicación con el servicio MCP:', error);
        // Devolvemos un objeto de error estandarizado
        return { error: 'No se pudo conectar con el servicio de la base de datos.' };
    }
};