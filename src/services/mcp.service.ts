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

type PendingRequest = {
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
};
const pendingRequests = new Map<string, PendingRequest>();

let eventSource: EventSource | null = null;
let sessionUrl: string | null = null;
let connectionPromise: Promise<string> | null = null;

// Mapa para rastrear qué sesiones ya han sido inicializadas.
const initializedSessions = new Set<string>();

function initializePersistentConnection(): Promise<string> {
    if (connectionPromise) {
        return connectionPromise;
    }

    connectionPromise = new Promise((resolve, reject) => {
        console.log('🤝 Abriendo conexión SSE persistente...');
        const handshakeUrl = `${env.mcpServerUrl.replace(/\/$/, '')}/sse`;
        eventSource = new EventSource(handshakeUrl);

        eventSource.addEventListener('endpoint', (event: any) => {
            sessionUrl = `${env.mcpServerUrl.replace(/\/$/, '')}${event.data}`;
            console.log(`✅ Conexión persistente establecida. URL de sesión: ${sessionUrl}`);
            resolve(sessionUrl);
        });

        eventSource.addEventListener('message', (event: any) => {
            try {
                const response: JsonRpcResponse = JSON.parse(event.data);
                const { id, result, error } = response;

                if (id && pendingRequests.has(id)) {
                    const { resolve, reject } = pendingRequests.get(id)!;
                    if (error) {
                        reject(new Error(error.message));
                    } else {
                        resolve(result);
                    }
                    pendingRequests.delete(id);
                }
            } catch (e) {
                // Ignoramos mensajes que no son JSON, como los pings.
            }
        });

        eventSource.onerror = (err) => {
            console.error('❌ La conexión SSE persistente falló:', err);
            pendingRequests.forEach(p => p.reject(new Error('La conexión con el servidor MCP se ha perdido.')));
            pendingRequests.clear();
            initializedSessions.clear();
            eventSource?.close();
            eventSource = null;
            sessionUrl = null;
            connectionPromise = null;
            reject(err);
        };
    });
    return connectionPromise;
}

class MCPService {
    public async executeTool(toolName: string, toolArgs: any): Promise<any> {
        try {
            const currentSessionUrl = await initializePersistentConnection();

            // --- ¡PASO CLAVE DE INICIALIZACIÓN! ---
            // Verificamos si esta URL de sesión ya fue inicializada.
            if (!initializedSessions.has(currentSessionUrl)) {
                console.log(`➡️  Enviando 'initialize' para activar la sesión...`);
                const initPayload = {
                    jsonrpc: "2.0",
                    method: "initialize",
                    params: { capabilities: {}, client: { name: "fp-agent-whatsapp-bot" } },
                    id: randomUUID()
                };
                
                const initResponse = await fetch(currentSessionUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(initPayload),
                });

                if (!initResponse.ok) {
                    throw new Error(`El servidor rechazó la petición de inicialización con status ${initResponse.status}`);
                }
                
                console.log(`✅ Sesión activada con éxito (Status: ${initResponse.status}).`);
                initializedSessions.add(currentSessionUrl);
            }

            // --- AHORA, ENVIAMOS LA HERRAMIENTA ---
            const requestId = randomUUID();
            const toolPayload = {
                jsonrpc: "2.0",
                method: "tools/call",
                params: { name: toolName, arguments: toolArgs },
                id: requestId,
            };

            const responsePromise = new Promise((resolve, reject) => {
                pendingRequests.set(requestId, { resolve, reject });
                setTimeout(() => {
                    if (pendingRequests.has(requestId)) {
                        pendingRequests.delete(requestId);
                        reject(new Error(`Timeout: No se recibió respuesta para la petición en 30 segundos.`));
                    }
                }, 30000);
            });

            console.log(`➡️  Enviando 'tools/call' (ID: ${requestId.substring(0,8)})`);
            
            const postResponse = await fetch(currentSessionUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(toolPayload),
            });

            if (!postResponse.ok) {
                pendingRequests.delete(requestId);
                throw new Error(`El servidor rechazó la petición de la herramienta con status ${postResponse.status}`);
            }

            return await responsePromise;

        } catch (error) {
            console.error('❌ Fallo en executeTool:', error);
            const errorMessage = error instanceof Error ? error.message : 'Error desconocido.';
            return { error: errorMessage };
        }
    }
}

const mcpService = new MCPService();

export const executeSql = (payload: any, state: SessionState) => {
    return mcpService.executeTool('run_query_json', payload);
};