import { MCPClient } from 'mcp-client';
import { env } from '../config/environment';

export interface SessionState { get<T>(key: string): T; update(data: Record<string, any>): Promise<any>; }

const client = new MCPClient({ name: "fp-agent-whatsapp-bot", version: "1.0.0" });
let connectionPromise: Promise<void> | null = null;

async function ensureConnection() {
    if (!connectionPromise) {
        console.log('🤝 [mcp.service.ts] No hay conexión activa. Conectando al servidor MCP...');
        const serverUrl = env.mcpServerUrl.replace(/\/$/, '');
        connectionPromise = client.connect({
            type: 'sse',
            url: `${serverUrl}/sse`
        });
        try {
            await connectionPromise;
            console.log('✅ [mcp.service.ts] Conexión MCP establecida con éxito.');
        } catch (error) {
            console.error('❌ [mcp.service.ts] Fallo al establecer la conexión inicial con MCP:', error);
            connectionPromise = null;
            if (error instanceof Error) {
                throw new Error(error.message);
            } else {
                throw new Error(String(error));
            }
        }
    }
    return connectionPromise;
}

class MCPService {
    public async executeTool(toolName: string, toolArgs: any): Promise<any> {
        try {
            await ensureConnection();
            console.log(`➡️  [mcp.service.ts] Enviando la herramienta '${toolName}'...`);
            
            const result = await client.callTool({ name: toolName, arguments: toolArgs });
            
            console.log('⬅️  [mcp.service.ts] Respuesta CRUDA recibida de mcp-client:', result);

            if (result.isError) {
                const errorMessage = String(result.content[0]?.text || 'Error desconocido del servidor');
                throw new Error(errorMessage);
            }

            const responseText = result.content[0]?.text;
            if (!responseText) {
                console.warn("⚠️ [mcp.service.ts] La respuesta del servidor estaba vacía. Devolviendo objeto de éxito vacío.");
                return { status: "success", data: [] };
            }

            const responseObject = JSON.parse(responseText as string);
            
            // --- ¡LA SOLUCIÓN FINAL A TODO! ---
            // El servidor nos devuelve un objeto JSON-RPC completo.
            // Debemos buscar dentro de la clave 'result' para encontrar nuestros datos.
            const toolResult = responseObject.result;

            if (toolResult && toolResult.status === 'success') {
                // Si la operación fue exitosa, devolvemos el objeto de resultado completo
                // para que el flujo principal pueda inspeccionarlo (data, rows_affected, etc.)
                return toolResult;
            } else if (responseObject.error) {
                // Si la respuesta JSON-RPC contiene un error, lo propagamos.
                throw new Error(responseObject.error.message);
            } else {
                // Fallback por si la estructura es inesperada.
                console.warn("⚠️ [mcp.service.ts] La estructura de la respuesta JSON-RPC era inesperada:", responseObject);
                return { error: "Respuesta inesperada del servidor." };
            }

        } catch (error) {
            let errorMessage: string;
            if (error instanceof Error) {
                errorMessage = error.message;
            } else {
                errorMessage = String(error);
            }
            
            console.error('❌ [mcp.service.ts] Fallo en la ejecución de la herramienta:', errorMessage);
            connectionPromise = null; 
            
            return { error: errorMessage };
        }
    }
}

const mcpService = new MCPService();

export const executeSql = (payload: any, state: SessionState) => {
    return mcpService.executeTool('run_query_json', payload);
};