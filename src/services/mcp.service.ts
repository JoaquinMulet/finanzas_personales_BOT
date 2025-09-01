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
    } else {
        console.log('✅ [mcp.service.ts] La conexión ya está establecida o en proceso. Reutilizando.');
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

            // --- ¡LA SOLUCIÓN FINAL! ---
            // Hemos descubierto que el resultado real está en el texto del primer bloque de contenido.
            const responseText = result.content[0]?.text;

            if (!responseText) {
                // Si la respuesta no tiene un bloque de texto, es una respuesta vacía válida.
                // Devolvemos un objeto que la lógica de negocio pueda interpretar como "nada encontrado".
                console.warn("⚠️ [mcp.service.ts] La respuesta del servidor no contenía un bloque de texto. Devolviendo objeto de éxito vacío.");
                return { status: "success", data: [] };
            }

            const responseObject = JSON.parse(responseText as string);
            
            if (responseObject.error) {
                // Propagamos el error de negocio que el servidor nos envió.
                throw new Error(responseObject.error.message);
            }

            // Devolvemos el objeto `result` completo que está dentro de la respuesta JSON-RPC.
            // Esto contiene `status`, `data`, `rows_affected`, etc.
            return responseObject.result;

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