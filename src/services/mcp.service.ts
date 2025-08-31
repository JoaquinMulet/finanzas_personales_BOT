// src/services/mcp.service.ts

import { ChildProcess } from 'child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { env } from '../config/environment';

class MCPService {
    private client: Client | null = null;
    private transport: StdioClientTransport | null = null;
    private isInitializing: boolean = false;
    private initializationPromise: Promise<void> | null = null;

    constructor() {
        // La inicialización se llama bajo demanda la primera vez que se usa.
    }

    private async initialize(): Promise<void> {
        if (this.client) return;
        if (this.isInitializing) return this.initializationPromise!;

        this.isInitializing = true;
        this.initializationPromise = new Promise(async (resolve, reject) => {
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

                this.transport = new StdioClientTransport({
                    command: command,
                    args: args,
                    env: { ...process.env, PGPASSWORD: env.db.password }
                });

                this.client = new Client({ name: "fp-agent-client", version: "1.0.0" });
                await this.client.connect(this.transport);
                
                // ¡CORRECCIÓN! Obtenemos y guardamos el proceso hijo

                
                const { tools } = await this.client.listTools();
                console.log(`✅ Conectado al servidor MCP local con herramientas: ${tools.map(t => t.name).join(', ')}`);


                
                this.isInitializing = false;
                resolve();

            } catch (error) {
                console.error('❌ Fallo catastrófico al iniciar la sesión MCP:', error);
                this.isInitializing = false;
                reject(error);
            }
        });
        return this.initializationPromise;
    }

    public async executeSql(query: string | string[]): Promise<any> {
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
    
    // ¡OMISIÓN AÑADIDA! Método para un cierre limpio.
    public close() {
        if (this.transport) {
            console.log('🔌 Closing the MCP transport...');
            this.transport.close();
        }
    }
}

// Creamos una única instancia (Singleton) para toda la aplicación
const mcpService = new MCPService();

// Exportamos solo la función que el main.flow necesita,
// manteniendo la clase encapsulada.
export const executeSql = (query: string | string[]) => mcpService.executeSql(query);

// Podríamos añadir un manejador para el cierre de la aplicación principal
// para llamar a mcpService.close() y asegurar una limpieza adecuada.
process.on('SIGINT', () => {
  mcpService.close();
  process.exit();
});