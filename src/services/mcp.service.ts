import { MCPClient } from 'mcp-client';
import { env } from '../config/environment';

export interface SessionState { get<T>(key: string): T; update(data: Record<string, any>): Promise<any>; }

const client = new MCPClient({ name: "fp-agent-whatsapp-bot", version: "1.0.0" });
async function ensureConnection() {
    try {
        console.log('🤝 [mcp.service.ts] Asegurando conexión con el servidor MCP...');
        const serverUrl = env.mcpServerUrl.replace(/\/$/, '');
        await client.connect({ type: 'sse', url: `${serverUrl}/sse` });
        console.log('✅ [mcp.service.ts] Conexión MCP asegurada.');
    } catch (error) {
        console.error('❌ [mcp.service.ts] Fallo al conectar con MCP:', error);
        // Re-throw the error to allow the caller to handle it
        throw error;
    }
}

class MCPService {
    public async executeTool(toolName: string, toolArgs: any): Promise<any> {
        try {
            await ensureConnection();
            console.log(`➡️  [mcp.service.ts] Enviando la herramienta '${toolName}' con payload:`, JSON.stringify(toolArgs, null, 2));
            
            const result = await client.callTool({ name: toolName, arguments: toolArgs });
            
            console.log('⬅️  [mcp.service.ts] Respuesta CRUDA recibida de mcp-client:', result);
            
            let content = result.structuredContent;
            console.log('⬅️  [mcp.service.ts] Contenido estructurado extraído:', content);

            if (typeof content === 'string') {
                console.log('ℹ️  [mcp.service.ts] El contenido es un string, parseando a JSON...');
                content = JSON.parse(content);
                console.log('ℹ️  [mcp.service.ts] Contenido parseado:', content);
            }
            
            if (content && content.status === 'success' && content.data !== undefined) {
                console.log('✅ [mcp.service.ts] Devolviendo campo "data" del resultado.');
                return content.data;
            } else if (content && content.error) {
                console.error('❌ [mcp.service.ts] El servidor devolvió un error de negocio:', content.error);
                return { error: content.error };
            }

            console.warn("⚠️ [mcp.service.ts] El contenido no tenía el formato esperado. Devolviendo [] como fallback.");
            return [];
        } catch (error) {
            console.error('❌ [mcp.service.ts] Fallo en la ejecución de la herramienta con mcp-client:', error);
            // The connection logic is now handled within ensureConnection, 
            // so we just log the error here. 
            const errorMessage = error instanceof Error ? error.message : 'Error desconocido.';
            return { error: errorMessage };
        }
    }
}

const mcpService = new MCPService();
export const executeSql = (payload: any, state: SessionState) => {
    return mcpService.executeTool('run_query_json', payload);
};