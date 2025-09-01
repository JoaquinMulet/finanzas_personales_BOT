import { env } from '../config/environment';
import { randomUUID } from 'crypto';

// Definimos una interfaz para el objeto de estado, especificando solo los métodos que usamos.
// Esto desacopla nuestro servicio de la implementación concreta de BotState de Builderbot.
export interface SessionState {
    get<T>(key: string): T;
    update(data: Record<string, any>): Promise<any>;
}

// Definimos una interfaz para la respuesta JSON-RPC para mayor claridad y seguridad de tipos.
interface JsonRpcResponse {
  jsonrpc: string;
  id: string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any; // El campo 'data' puede existir en errores más detallados
  };
}

class MCPService {
    private mcpServerUrl: string;

    constructor() {
        if (!env.mcpServerUrl) {
            throw new Error('MCP_SERVER_URL no está configurado en el entorno.');
        }
        // Asegura que la URL tenga el protocolo y elimina la barra final si existe.
        const baseUrl = env.mcpServerUrl.startsWith('http')
            ? env.mcpServerUrl
            : `https://${env.mcpServerUrl}`;
        
        this.mcpServerUrl = baseUrl.replace(/\/$/, '');
    }

    /**
     * Asegura que exista una sesión MCP válida para la conversación actual.
     * Si ya existe un ID de sesión en el estado, lo reutiliza.
     * Si no, crea una nueva sesión y guarda el ID en el estado para futuras solicitudes.
     * @param state El objeto de estado de la conversación actual de Builderbot.
     * @returns Una promesa que resuelve al ID de la sesión MCP.
     */
    private async ensureSession(state: SessionState): Promise<string> {
        const currentSessionId = state.get<string>('mcpSessionId');
        
        if (currentSessionId) {
            console.log(`✅ Reutilizando sesión MCP existente del estado: ${currentSessionId.substring(0, 8)}...`);
            return Promise.resolve(currentSessionId);
        }

        console.log('🤝 No se encontró sesión en el estado. Iniciando una nueva sesión MCP...');
        
        const initPayload = {
            jsonrpc: "2.0",
            method: "initialize",
            params: {
                capabilities: { tools: {}, resources: {} },
                client: { name: "fp-agent-whatsapp-bot", version: "1.0.0" }
            },
            id: randomUUID()
        };
        
        const response = await fetch(`${this.mcpServerUrl}/mcp`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json', 
                'Accept': 'application/json, text/event-stream'
            },
            body: JSON.stringify(initPayload),
        });

        if (!response.ok) {
            throw new Error(`Fallo en la inicialización de la sesión MCP: ${response.status} ${await response.text()}`);
        }
        
        const sessionId = response.headers.get('mcp-session-id');
        if (!sessionId) {
            throw new Error('El servidor MCP no devolvió un mcp-session-id en las cabeceras durante la inicialización.');
        }
        
        // ¡Mejora Clave! Guardamos el nuevo ID de sesión en el estado de Builderbot.
        await state.update({ mcpSessionId: sessionId });
        
        console.log(`✅ Nueva sesión MCP establecida y guardada en el estado. ID: ${sessionId.substring(0, 8)}...`);
        return sessionId;
    }

    /**
     * Parsea una respuesta que podría venir como text/event-stream.
     * Extrae el objeto JSON completo de la línea que comienza con 'data:'.
     */
    private async parseStreamingResponse(response: Response): Promise<string> {
        const contentType = response.headers.get('content-type');
        
        // Si no es un stream, simplemente devuelve el texto.
        if (!contentType || !contentType.includes('text/event-stream')) {
            return await response.text();
        }

        const fullText = await response.text();
        console.log('📄 [PARSER] Texto completo ensamblado del stream:\n--- TEXTO COMPLETO ---\n' + fullText + '\n--- FIN TEXTO COMPLETO ---');
        
        const lines = fullText.split('\n').filter(line => line.trim() !== '');
        const dataLine = lines.find(line => line.startsWith('data:'));
        
        if (dataLine) {
            const jsonContent = dataLine.substring(5).trim();
            console.log(`✨ [PARSER] Contenido JSON extraído para parsear: "${jsonContent}"`);
            return jsonContent;
        } else {
            console.log('⚠️ [PARSER] No se encontró una línea "data:". Se usará el texto completo.');
            return fullText;
        }
    }

    /**
     * Ejecuta una herramienta en el servidor MCP usando la sesión del estado de la conversación.
     * @param toolName El nombre de la herramienta a llamar (ej. 'run_query_json').
     * @param toolArgs Los argumentos para la herramienta.
     * @param state El objeto de estado de la conversación actual de Builderbot.
     * @returns El resultado de la herramienta o un objeto de error.
     */
    public async executeTool(toolName: string, toolArgs: any, state: SessionState): Promise<any> {
        try {
            const sessionId = await this.ensureSession(state);

            const mcpPayload = {
                jsonrpc: "2.0",
                method: "tools/call",
                params: {
                    name: toolName,
                    arguments: toolArgs
                },
                id: randomUUID()
            };

            const endpoint = `${this.mcpServerUrl}/mcp`;
            console.log(`➡️  Enviando Payload a MCP en ${endpoint} con Sesión ID: ${sessionId.substring(0, 8)}...`);
            console.log(JSON.stringify(mcpPayload, null, 2));
            
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json', 
                    'Accept': 'application/json, text/event-stream',
                    'mcp-session-id': sessionId // Usamos el ID de sesión obtenido del estado.
                },
                body: JSON.stringify(mcpPayload),
            });
            
            console.log(`📥 [HTTP] Respuesta recibida con Status: ${response.status} ${response.statusText}`);
            
            const responseText = await this.parseStreamingResponse(response);

            if (!response.ok) {
                // Intenta parsear una respuesta de error JSON si es posible.
                try {
                    const errorJson: JsonRpcResponse = JSON.parse(responseText);
                    if (errorJson.error) {
                        throw new Error(`Error reportado por el servidor MCP: ${errorJson.error.message} (Código: ${errorJson.error.code})`);
                    }
                } catch (e) {
                    // Si no es un JSON válido, lanza el error HTTP.
                    throw new Error(`El servidor MCP respondió con un error HTTP: ${response.status} - ${responseText}`);
                }
            }
            
            const result: JsonRpcResponse = JSON.parse(responseText);
            console.log('✔️ [JSON] Parseo de respuesta exitoso.');

            if (result.error) {
                // Si el error indica una sesión inválida, la limpiamos del estado.
                // Esto permite una recuperación automática en el próximo intento.
                if (result.error.code === -32001) { // -32001 es un código común para "Sesión no encontrada"
                    console.log('🔥 La sesión MCP no fue encontrada en el servidor. Limpiando del estado local.');
                    await state.update({ mcpSessionId: null });
                }
                throw new Error(`Error en la respuesta JSON-RPC: ${result.error.message}`);
            }

            console.log('⬅️  Respuesta exitosa recibida de MCP.');
            return result.result;

        } catch (error) {
            console.error('❌ Fallo la comunicación con el servicio MCP:', error);
            const errorMessage = error instanceof Error ? error.message : 'Error desconocido al comunicarse con el servicio MCP.';
            return { error: errorMessage };
        }
    }
}

// Creamos una única instancia del servicio para ser usada en toda la aplicación.
const mcpService = new MCPService();

/**
 * Función de conveniencia para ejecutar consultas SQL a través del servicio MCP.
 * Actúa como un adaptador entre el flujo y la lógica del servicio MCP.
 * @param payload Los argumentos para la herramienta 'run_query_json'.
 * @param state El objeto de estado de la conversación actual de Builderbot.
 */
export const executeSql = (payload: any, state: SessionState) => {
    // Recordatorio: El payload ya debe tener la estructura correcta esperada por
    // la herramienta en el servidor (plana o anidada, según tu implementación final).
    return mcpService.executeTool('run_query_json', payload, state);
};