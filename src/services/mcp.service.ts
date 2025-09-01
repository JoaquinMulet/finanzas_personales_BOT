import { env } from '../config/environment';
import { randomUUID } from 'crypto';
import { EventSource } from 'eventsource';

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

    private ensureSession(state: SessionState): Promise<string> {
        return new Promise((resolve, reject) => {
            const currentSessionUrl = state.get<string>('mcpSessionUrl');
            if (currentSessionUrl) {
                return resolve(currentSessionUrl);
            }

            console.log('🤝 Iniciando handshake SSE para obtener URL de sesión...');
            const handshakeUrl = `${this.mcpServerUrl}/sse`;
            const es = new EventSource(handshakeUrl);

            es.addEventListener('endpoint', (event: any) => {
                const sessionPath = event.data;
                if (sessionPath) {
                    const fullSessionUrl = `${this.mcpServerUrl}${sessionPath}`;
                    console.log(`✅ Handshake exitoso. URL de sesión: ${fullSessionUrl}`);
                    state.update({ mcpSessionUrl: fullSessionUrl }).then(() => {
                        resolve(fullSessionUrl);
                    });
                } else {
                    reject(new Error('Handshake no proporcionó una ruta de sesión.'));
                }
                es.close();
            });

            es.onerror = (err) => {
                reject(new Error('Fallo en el handshake SSE.'));
                es.close();
            };
        });
    }
    
    public async executeTool(toolName: string, toolArgs: any, state: SessionState): Promise<any> {
        try {
            const sessionEndpoint = await this.ensureSession(state);

            // --- PASO 1: ENVIAR 'initialize' ---
            // Enviamos el mensaje de inicialización pero no esperamos un JSON de vuelta.
            // Esto "prepara" la sesión en el servidor.
            const initPayload = {
                jsonrpc: "2.0",
                method: "initialize",
                params: { capabilities: {}, client: { name: "fp-agent-whatsapp-bot" } },
                id: randomUUID()
            };

            console.log(`➡️  Enviando 'initialize' a la URL de sesión...`);
            const initResponse = await fetch(sessionEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(initPayload),
            });

            // Solo verificamos que la petición fue aceptada. No intentamos parsear el cuerpo.
            if (!initResponse.ok) {
                throw new Error(`La petición de inicialización falló con status: ${initResponse.status}`);
            }
            console.log(`✅ Petición 'initialize' aceptada por el servidor (Status: ${initResponse.status}).`);

            // --- PASO 2: ENVIAR 'tools/call' Y ESPERAR EL RESULTADO JSON ---
            // Ahora enviamos la petición real y esperamos el resultado de la consulta.
            const toolPayload = {
                jsonrpc: "2.0",
                method: "tools/call",
                params: { name: toolName, arguments: toolArgs },
                id: randomUUID()
            };

            console.log(`➡️  Enviando 'tools/call' para obtener el resultado...`);
            const toolResponse = await fetch(sessionEndpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
                body: JSON.stringify(toolPayload),
            });

            if (!toolResponse.ok) {
                throw new Error(`La petición de la herramienta falló: ${toolResponse.status} - ${await toolResponse.text()}`);
            }

            // Esta vez, SÍ esperamos un JSON válido como respuesta.
            const result: JsonRpcResponse = await toolResponse.json();
            
            if (result.error) {
                throw new Error(`Error en la respuesta de la herramienta: ${result.error.message}`);
            }
            
            console.log('⬅️  Respuesta JSON de la herramienta recibida con éxito.');
            return result.result;

        } catch (error) {
            console.error('❌ Fallo la comunicación con el servicio MCP:', error);
            await state.update({ mcpSessionUrl: null });
            const errorMessage = error instanceof Error ? error.message : 'Error desconocido.';
            return { error: errorMessage };
        }
    }
}

const mcpService = new MCPService();

export const executeSql = (payload: any, state: SessionState) => {
    return mcpService.executeTool('run_query_json', payload, state);
};