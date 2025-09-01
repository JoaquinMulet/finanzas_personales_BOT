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

// Mapa para rastrear las peticiones pendientes y sus callbacks de Promise.
// La clave es el ID de la petición, el valor son las funciones para resolver/rechazar la promesa.
type PendingRequest = {
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
};
const pendingRequests = new Map<string, PendingRequest>();

// Variables para gestionar la conexión persistente.
let eventSource: EventSource | null = null;
let sessionUrl: string | null = null;
let connectionPromise: Promise<string> | null = null;

/**
 * Inicia y mantiene una conexión SSE persistente con el servidor MCP.
 * Solo se ejecuta una vez.
 */
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

        // Este es el listener principal para recibir los resultados de las herramientas.
        eventSource.addEventListener('message', (event: any) => {
            try {
                const response: JsonRpcResponse = JSON.parse(event.data);
                const { id, result, error } = response;

                if (id && pendingRequests.has(id)) {
                    const { resolve, reject } = pendingRequests.get(id)!;
                    if (error) {
                        console.log(`⬅️  Respuesta de error recibida para ID ${id}:`, error.message);
                        reject(new Error(error.message));
                    } else {
                        console.log(`⬅️  Respuesta exitosa recibida para ID ${id}.`);
                        resolve(result);
                    }
                    pendingRequests.delete(id);
                }
            } catch (e) {
                console.warn('⚠️  Mensaje SSE recibido no era un JSON-RPC válido:', event.data);
            }
        });

        eventSource.onerror = (err) => {
            console.error('❌ La conexión SSE persistente falló:', err);
            // Rechaza todas las promesas pendientes si la conexión muere.
            pendingRequests.forEach(p => p.reject(new Error('La conexión con el servidor MCP se ha perdido.')));
            pendingRequests.clear();
            eventSource?.close();
            eventSource = null;
            sessionUrl = null;
            connectionPromise = null; // Permite reintentar la conexión.
            reject(err);
        };
    });
    return connectionPromise;
}

class MCPService {
    /**
     * Envía un comando al servidor y espera la respuesta a través del stream SSE.
     */
    public async executeTool(toolName: string, toolArgs: any): Promise<any> {
        try {
            // Asegura que la conexión persistente esté activa y obtenemos la URL de sesión.
            const currentSessionUrl = await initializePersistentConnection();

            // Creamos un ID único para esta petición específica.
            const requestId = randomUUID();
            const toolPayload = {
                jsonrpc: "2.0",
                method: "tools/call",
                params: { name: toolName, arguments: toolArgs },
                id: requestId,
            };

            // Creamos una promesa que se resolverá cuando llegue la respuesta por el stream SSE.
            const responsePromise = new Promise((resolve, reject) => {
                pendingRequests.set(requestId, { resolve, reject });
                // Añadimos un timeout para no esperar indefinidamente.
                setTimeout(() => {
                    if (pendingRequests.has(requestId)) {
                        pendingRequests.delete(requestId);
                        reject(new Error(`Timeout: No se recibió respuesta para la petición ${requestId} en 30 segundos.`));
                    }
                }, 30000); // 30 segundos de timeout
            });

            console.log(`➡️  Enviando 'tools/call' (ID: ${requestId.substring(0,8)}) a ${currentSessionUrl}`);
            
            // Enviamos el POST. No esperamos el JSON de esta respuesta.
            const postResponse = await fetch(currentSessionUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(toolPayload),
            });

            if (!postResponse.ok) {
                // Si el POST falla, la petición no fue ni siquiera aceptada.
                pendingRequests.delete(requestId);
                throw new Error(`El servidor rechazó la petición POST con status ${postResponse.status}`);
            }

            // Esperamos a que la promesa sea resuelta por el listener de SSE.
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
    // El estado ya no es necesario para gestionar la sesión, pero lo mantenemos por consistencia de la firma.
    return mcpService.executeTool('run_query_json', payload);
};