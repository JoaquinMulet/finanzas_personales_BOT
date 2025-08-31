// src/flows/main.flow.ts

import { addKeyword, EVENTS } from '@builderbot/bot';
import { env } from '../config/environment';
import { getAIResponse } from '../services/openrouter.service';
import { executeSql } from '../services/mcp.service';
// ¡CORREGIDO! Ya no importamos nada del servicio de memoria.
import { ChatCompletionMessageParam } from 'openai/resources';

const CONVERSATION_EXPIRATION_MS = 30 * 60 * 1000; // 30 minutos

export const mainFlow = addKeyword(EVENTS.WELCOME)
    // 1. CONTROL DE SEGURIDAD: Usamos una acción separada para la claridad.
    .addAction(async (ctx, { endFlow }) => {
        if (ctx.from !== env.myPhoneNumber) {
            console.log(`🚫 Mensaje ignorado de un número no autorizado: ${ctx.from}`);
            return endFlow(); // Termina el flujo inmediatamente si el número no es el tuyo.
        }
    })
    // 2. ACCIÓN PRINCIPAL: Orquesta la conversación con la IA.
    .addAction(async (ctx, { state, flowDynamic }) => {
        // --- GESTIÓN DE MEMORIA A CORTO PLAZO (HISTORIAL DE LA CONVERSACIÓN) ---
        const lastInteraction = state.get('lastInteraction') || 0;
        const now = Date.now();
        let history = state.get<ChatCompletionMessageParam[]>('history') || [];

        if (now - lastInteraction > CONVERSATION_EXPIRATION_MS) {
            console.log('⏳ La conversación expiró. Reiniciando el historial.');
            history = [];
        }

        // --- PASO 1: OBTENER LA DECISIÓN DE LA IA ---
        console.log(`💬 Procesando mensaje: "${ctx.body}"`);
        const aiResponse = await getAIResponse(history, ctx.body);

        let finalResponse = 'Lo siento, ocurrió un error inesperado y no pude procesar tu solicitud.';

        // --- PASO 2: PROCESAR LA RESPUESTA DE LA IA ---
        if (aiResponse.type === 'tool') {
            const { tool, payload } = aiResponse.data;
            console.log(`🤖 La IA decidió usar la herramienta: ${tool}`);

            // ¡CORREGIDO! El switch ahora solo maneja las herramientas válidas.
            switch (tool) {
                case 'execute_sql':
                    const toolResult = await executeSql(payload.query);

                    // --- PASO 2.1 (MEJORA CLAVE): IA INTERPRETA EL RESULTADO ---
                    console.log('🧠 Pidiendo a la IA que interprete el resultado de la herramienta...');
                    // Creamos un prompt de sistema temporal para esta tarea específica.
                    const contextForInterpretation = `El sistema ejecutó la consulta SQL que pediste. 
                    - Tu consulta fue: "${payload.query}"
                    - El resultado fue: ${JSON.stringify(toolResult)}.
                    Ahora, por favor, genera una respuesta final y amigable para el usuario informándole del resultado. 
                    Si la operación fue un INSERT o UPDATE exitoso, confirma la acción.
                    Si fue un SELECT, resume los datos encontrados de forma clara.
                    Si hubo un error, díselo de manera sencilla.`;
                    
                    const interpretation = await getAIResponse(
                        [...history, { role: 'user', content: ctx.body }],
                        contextForInterpretation
                    );
                    
                    // Extraemos la respuesta de texto de la interpretación.
                    if (interpretation.type === 'tool' && interpretation.data.tool === 'respond_to_user') {
                        finalResponse = interpretation.data.payload.response;
                    } else if (interpretation.type === 'text') {
                        finalResponse = interpretation.data;
                    } else {
                        finalResponse = "Acción completada."; // Fallback de seguridad
                    }
                    break;
                
                case 'respond_to_user':
                    // La IA decidió que solo necesita hablar con el usuario.
                    finalResponse = payload.response;
                    break;

                default:
                    console.log(`⚠️ La IA intentó usar una herramienta desconocida: ${tool}`);
                    finalResponse = "Lo siento, intenté hacer algo que no está permitido.";
            }
        } else if (aiResponse.type === 'text') {
            // Si la IA responde con texto (aunque no debería por el formato JSON), lo manejamos.
            finalResponse = aiResponse.data;
        }
        
        // --- PASO 3: ACTUALIZAR HISTORIAL Y ENVIAR RESPUESTA FINAL AL USUARIO ---
        console.log(`➡️  Enviando respuesta final: "${finalResponse}"`);
        const newHistory: ChatCompletionMessageParam[] = [
            ...history,
            { role: 'user', content: ctx.body },
            { role: 'assistant', content: finalResponse }
        ];

        // Guardamos el nuevo historial y la marca de tiempo.
        await state.update({ history: newHistory, lastInteraction: now });
        
        // Enviamos el mensaje por WhatsApp.
        await flowDynamic(finalResponse);
    });