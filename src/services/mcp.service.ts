// src/services/mcp.service.ts

import { ChildProcess } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { env } from '../config/environment';

class MCPService {
    private client: Client | null = null;
    
    private isInitializing: boolean = false;
    private initializationPromise: Promise<void> | null = null;

    constructor() {
        // La inicialización se llama bajo demanda.
    }

    // ¡CORRECCIÓN! Eliminamos el constructor `new Promise` y hacemos
    // que el método en sí sea el gestor de la promesa.
    private async initialize(): Promise<void> {
        if (this.client) return;
        if (this.isInitializing) return this.initializationPromise!;

        // Marcamos que estamos inicializando y asignamos la promesa directamente
        // a la ejecución de una nueva función asíncrona.
        this.isInitializing = true;
        this.initializationPromise = (async () => {
            try {
                console.log('🚀 Lanzando el proceso del servidor postgres-mcp...');

                const command = '/opt/venv_python/bin/postgres-mcp';
                const args = [
                    '--access-mode=unrestricted',
                    env.db.host,
                    '-p', env.db.port.toString(),
                    '-U', env.db.user,
                    '-d', env.db.database
                ];

                const transport = new StdioClientTransport({
                    command: command,
                    args: args,
                    env: { ...process.env, PGPASSWORD: env.db.password }
                });

                this.client = new Client({ name: "fp-agent-client", version: "1.0.0" });
                await this.client.connect(transport);
                
                const { tools } = await this.client.listTools();
                console.log(`✅ Conectado al servidor MCP local con herramientas: ${tools.map(t => t.name).join(', ')}`);

                transport.onclose = () => {
                    console.log('MCP transport closed');
                    this.client = null;
                    this.isInitializing = false;
                    this.initializationPromise = null; // Reseteamos la promesa
                };

            } catch (error) {
                console.error('❌ Fallo catastrófico al iniciar la sesión MCP:', error);
                // Si falla, reseteamos el estado para permitir un nuevo intento.
                this.isInitializing = false;
                this.initializationPromise = null;
                // Re-lanzamos el error para que la promesa se rechace
                throw error; 
            }
        })();
        
        // Esperamos a que la promesa de inicialización se complete
        await this.initializationPromise;
        // Una vez completada (o si falla), reseteamos el estado de "inicializando"
        this.isInitializing = false;
    }

    public async executeSql(query: string | string[]): Promise<any> {
        // La lógica aquí no necesita cambiar. El await a initialize() ahora es más seguro.
        if (!this.client) {
            await this.initialize();
            if (!this.client) {
                 throw new Error('El cliente MCP no se pudo inicializar.');
            }
        }

        try {
            console.log(`➡️  Enviando SQL a MCP (proceso local)...`);
            const result = await this.client.callTool({
                name: 'execute_sql',
                arguments: { query }
            });
            
            console.log('⬅️  Respuesta recibida de MCP.');
            if (result.content && result.content[0].type === 'text') {
                try {
                    return JSON.parse(result.content[0].text);
                } catch {
                    return result.content[0].text;
                }
            }
            return result.content;
        } catch (error) {
            console.error('❌ Error al ejecutar la herramienta SQL en MCP:', error);
            return { error: 'Hubo un error al ejecutar la consulta SQL.' };
        }
    }
    
    public async close() {
        if (this.client) {
            console.log('🔌 Disconnecting the MCP client...');
            await this.client.close();
            this.client = null;
        }
    }
}

const mcpService = new MCPService();
export const executeSql = (query: string | string[]) => mcpService.executeSql(query);

process.on('SIGINT', () => {
  mcpService.close();
  process.exit();
});