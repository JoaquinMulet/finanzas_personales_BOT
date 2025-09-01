import { env } from '../config/environment';
import { randomUUID } from 'crypto';
import { EventSource } from 'eventsource';

// Interfaz para el estado, para mantener el código desacoplado.
export interface SessionState {
    get<T>(key: string): T;
    update(data: Record<string, any>): Promise<any>;
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: string;
  result?: any;
  error?: { code: number; message: string; data?: any; };
}

class MCPService {
    private mcpServerUrl: string;

    constructor() {
        if (!env.mcpServerUrl) {
            throw new Error('MCP_SERVER_URL no está configurado en el entorno.');
        }
        const baseUrl = env.mcpServerUrl.startsWith('http')
            ? env.mcpServerUrl
            : `https://${env.mcpServerUrl}`;
        this.mcpServerUrl = baseUrl.replace(/\/$/, '');
    }

    /**
     * Realiza el handshake SSE para obtener una URL de sesión única.
     * Si ya existe una URL en el estado, la reutiliza.
     * @param state El estado de la conversación.
     * @returns Una promesa que resuelve a la URL de sesión completa.
     */
    private ensureSession(state: SessionState): Promise<string> {
        return new Promise(async (resolve, reject) => {
            const currentSessionUrl = state.get<string>('mcpSessionUrl');
            if (currentSessionUrl) {
                console.log(`✅ Reutilizando URL de sesión MCP existente del estado.`);
                return resolve(currentSessionUrl);
            }

            console.log('🤝 No se encontró URL de sesión. Iniciando handshake SSE...');
            
            // La "puerta principal" para iniciar el handshake.
            const handshakeUrl = `${this.mcpServerUrl}/sse`;
            const es = new EventSource(handshakeUrl);

            // Listener para el evento 'endpoint' que nos da la URL de la sesión.
            es.addEventListener('endpoint', (event: any) => {
                const sessionPath = event.data;
                if (sessionPath) {
                    const fullSessionUrl = `${this.mcpServerUrl}${sessionPath}`;
                    console.log(`✅ Handshake exitoso. URL de sesión recibida: ${fullSessionUrl}`);
                    
                    // Guardamos la URL completa en el estado para reutilizarla.
                    state.update({ mcpSessionUrl: fullSessionUrl }).then(() => {
                        resolve(fullSessionUrl);
                    });
                } else {
                    reject(new Error('El servidor SSE no proporcionó una ruta de sesión válida.'));
                }
                // Cerramos la conexión de handshake, ya no es necesaria.
                es.close();
            });

            es.onerror = (err) => {
                console.error('❌ Error durante el handshake SSE:', err);
                reject(new Error('No se pudo establecer la conexión de handshake con el servidor MCP.'));
                es.close();
            };
        });
    }
    
    /**
     * Ejecuta una herramienta en el servidor MCP.
     * Primero obtiene la URL de sesión y luego envía las peticiones a esa URL.
     * @param toolName El nombre de la herramienta.
     * @param toolArgs Los argumentos para la herramienta.
     * @param state El estado de la conversación.
     * @returns El resultado de la herramienta o un objeto de error.
     */
    public async executeTool(toolName: string, toolArgs: any, state: SessionState): Promise<any> {
        let sessionEndpoint: string;
        try {
            // 1. Obtenemos la URL específica de esta sesión (ej: .../messages/?session_id=...)
            sessionEndpoint = await this.ensureSession(state);

            // 2. Enviamos el payload de inicialización a esa URL específica.
            // Algunas implementaciones de servidor requieren esto en cada nueva conexión.
            const initPayload = {
                jsonrpc: "2.0", method: "initialize",
                params: { capabilities: {}, client: { name: "fp-agent-whatsapp-bot" } },
                id: randomUUID()
            };

            const initResponse = await fetch(sessionEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(initPayload),
            });

            if (!initResponse.ok) throw new Error(`Fallo en la inicialización en el endpoint de sesión: ${initResponse.statusText}`);
            console.log("✅ Inicialización de sesión en endpoint específico exitosa.");
            
            // 3. Ahora, enviamos la llamada a la herramienta a la MISMA URL de sesión.
            const toolPayload = {
                jsonrpc: "2.0", method: "tools/call",
                params: { name: toolName, arguments: toolArgs },
                id: randomUUID()
            };

            console.log(`➡️  Enviando Payload de herramienta a la URL de sesión...`);
            const toolResponse = await fetch(sessionEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(toolPayload),
            });

            if (!toolResponse.ok) throw new Error(`El servidor MCP respondió con un error: ${toolResponse.status} - ${await toolResponse.text()}`);

            const result: JsonRpcResponse = await toolResponse.json();
            if (result.error) throw new Error(`Error en la respuesta JSON-RPC: ${result.error.message}`);
            
            console.log('⬅️  Respuesta exitosa recibida de MCP.');
            return result.result;

        } catch (error) {
            console.error('❌ Fallo la comunicación con el servicio MCP:', error);
            // Si hay un error, limpiamos la URL de la sesión para forzar un nuevo handshake.
            await state.update({ mcpSessionUrl: null });
            const errorMessage = error instanceof Error ? error.message : 'Error desconocido al conectar con el servidor MCP.';
            return { error: errorMessage };
        }
    }
}

const mcpService = new MCPService();

export const executeSql = (payload: any, state: SessionState) => {
    return mcpService.executeTool('run_query_json', payload, state);
};