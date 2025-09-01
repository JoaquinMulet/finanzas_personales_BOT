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
                // Lanzamos un error con un mensaje garantizado que es un string.
                throw new Error(errorMessage);
            }

            const responseText = result.content[0]?.text;
            if (!responseText) {
                // Lanzamos un error con un mensaje garantizado que es un string.
                throw new Error("La respuesta del servidor estaba vacía.");
            }

            // Type assertion: we know responseText is not null/undefined from the check above
            const responseObject = JSON.parse(responseText as string);
            
            if (responseObject.error) {
                // Lanzamos un error con un mensaje garantizado que es un string.
                throw new Error(responseObject.error.message);
            }

            const toolResult = responseObject.result;

            if (toolResult && toolResult.status === 'success' && toolResult.data !== undefined) {
                return toolResult.data;
            }
            
            return toolResult;

        } catch (error) {
            // --- ¡SOLUCIÓN APLICADA AQUÍ! ---
            // Verificamos de forma segura el tipo de 'error' antes de usarlo.
            let errorMessage: string;
            if (error instanceof Error) {
                // Si es un objeto Error, usamos su propiedad .message
                errorMessage = error.message;
            } else {
                // Si no, lo convertimos a un string de forma segura.
                errorMessage = String(error);
            }
            
            console.error('❌ [mcp.service.ts] Fallo en la ejecución de la herramienta:', errorMessage);

            // Reseteamos la promesa para forzar una reconexión la próxima vez.
            connectionPromise = null; 
            
            // Devolvemos un objeto de error consistente con un mensaje que es un string.
            return { error: errorMessage };
        }
    }
}

const mcpService = new MCPService();

export const executeSql = (payload: any, state: SessionState) => {
    return mcpService.executeTool('run_query_json', payload);
};