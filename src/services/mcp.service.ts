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
    try {
        if (connectionPromise) {
            await client.ping();
        }
    } catch (e) {
        console.log('MCP ping failed, reconnecting...');
        connectionPromise = null;
    }
    if (!connectionPromise) {
        console.log('🤝 Conectando al servidor MCP usando mcp-client...');
        const serverUrl = env.mcpServerUrl.replace(/\/$/, '');
        connectionPromise = client.connect({
            type: 'sse',
            url: `${serverUrl}/sse`
        });
        await connectionPromise;
        console.log('✅ Conexión con el servidor MCP establecida con éxito.');
    }
    return connectionPromise;
}

class MCPService {
    public async executeTool(toolName: string, toolArgs: any): Promise<any> {
        try {
            await ensureConnection();
            console.log(`➡️  Enviando la herramienta '${toolName}' con payload:`, toolArgs);
            
            const result = await client.callTool({
                name: toolName,
                arguments: toolArgs,
            });
            
            console.log('⬅️  Respuesta cruda recibida de mcp-client:', result);
            
            let content = result.structuredContent;

            if (typeof content === 'string') {
                content = JSON.parse(content);
            }
            
            if (content && content.status === 'success' && content.data !== undefined) {
                return content.data;
            } else if (content && content.error) {
                return { error: content.error };
            }

            return content;

        } catch (error) {
            console.error('❌ Fallo durante la ejecución de la herramienta con mcp-client:', error);
            connectionPromise = null; 
            const errorMessage = error instanceof Error ? error.message : 'Error desconocido al ejecutar la herramienta.';
            return { error: errorMessage };
        }
    }
}

const mcpService = new MCPService();

export const executeSql = (payload: any, state: SessionState) => {
    return mcpService.executeTool('run_query_json', payload);
};