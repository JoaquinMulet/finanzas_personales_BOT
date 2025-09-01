import { MCPClient } from 'mcp-client';
import { env } from '../config/environment';

export interface SessionState {
    get<T>(key: string): T;
    update(data: Record<string, any>): Promise<any>;
}

const client = new MCPClient({
  name: "fp-agent-whatsapp-bot",
  version: "1.0.0",
});

let connectionPromise: Promise<void> | null = null;

async function ensureConnection() {
    let isConnected = true;
    try {
        await client.ping();
    } catch (error) {
        isConnected = false;
    }

    if (!isConnected) {
        connectionPromise = null;
    }

    if (!connectionPromise) {
        console.log('🤝 Conectando al servidor MCP usando mcp-client...');
        const serverUrl = env.mcpServerUrl.replace(/\/$/, '');
        connectionPromise = client.connect({
            type: 'sse',
            url: `${serverUrl}/sse`
        });
        try {
            await connectionPromise;
            console.log('✅ Conexión con el servidor MCP establecida con éxito.');
        } catch (error) {
            connectionPromise = null;
            throw error;
        }
    }
    return connectionPromise;
}

class MCPService {
    public async executeTool(toolName: string, toolArgs: any): Promise<any> {
        try {
            await ensureConnection();
            console.log(`➡️  Enviando la herramienta '${toolName}' usando mcp-client...`);
            
            const result = await client.callTool({
                name: toolName,
                arguments: toolArgs,
            });
            
            console.log('⬅️  Respuesta de la herramienta recibida con éxito.');
            
            // --- ¡CAMBIOS FINALES AQUÍ! ---
            let content = result.structuredContent;

            // 1. Parsear el string JSON que devuelve el servidor.
            if (typeof content === 'string') {
                content = JSON.parse(content);
            }
            
            // 2. "Desempaquetar" el resultado para dárselo limpio al flujo principal.
            if (content && content.status === 'success' && content.data !== undefined) {
                return content.data; // Devolvemos solo el array de datos
            } else if (content && content.error) {
                return { error: content.error };
            }

            return content; // Fallback

        } catch (error) {
            console.error('❌ Fallo durante la ejecución de la herramienta con mcp-client:', error);
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