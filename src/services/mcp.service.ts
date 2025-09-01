import { MCPClient } from 'mcp-client';
import { env } from '../config/environment';

export interface SessionState { get<T>(key: string): T; update(data: Record<string, any>): Promise<any>; }

const client = new MCPClient({ name: "fp-agent-whatsapp-bot", version: "1.0.0" });
let connectionPromise: Promise<void> | null = null;

async function ensureConnection() {
    if (!connectionPromise) {
        console.log('🤝 Conectando al servidor MCP...');
        const serverUrl = env.mcpServerUrl.replace(/\/$/, '');
        connectionPromise = client.connect({ type: 'sse', url: `${serverUrl}/sse` });
        await connectionPromise;
        console.log('✅ Conexión MCP establecida.');
    }
    return connectionPromise;
}

class MCPService {
    public async executeTool(toolName: string, toolArgs: any): Promise<any> {
        try {
            await ensureConnection();
            console.log(`➡️  Enviando la herramienta '${toolName}'...`);
            const result = await client.callTool({ name: toolName, arguments: toolArgs });
            console.log('⬅️  Respuesta cruda de mcp-client:', result);
            
            let content = result.structuredContent;

            if (typeof content === 'string') { content = JSON.parse(content); }
            
            if (content && content.status === 'success' && content.data !== undefined) {
                return content.data;
            } else if (content && content.error) {
                return { error: content.error };
            }
            // --- ¡MANEJO DE UNDEFINED! ---
            // Si la llamada fue exitosa pero no hay contenido, devolvemos un array vacío.
            console.warn("Contenido de respuesta vacío/inesperado. Devolviendo [].");
            return [];
        } catch (error) {
            console.error('❌ Fallo en mcp-client:', error);
            connectionPromise = null; 
            const errorMessage = error instanceof Error ? error.message : 'Error desconocido.';
            return { error: errorMessage };
        }
    }
}

const mcpService = new MCPService();
export const executeSql = (payload: any, state: SessionState) => {
    return mcpService.executeTool('run_query_json', payload);
};