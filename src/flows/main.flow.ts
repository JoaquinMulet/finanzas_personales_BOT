// src/flows/main.flow.ts

import { addKeyword, EVENTS } from '@builderbot/bot';
import { env } from '../config/environment';
import { getAIResponse } from '../services/openrouter.service';
import { executeSql } from '../services/mcp.service';
import { ChatCompletionMessageParam } from 'openai/resources';

const CONVERSATION_EXPIRATION_MS = 30 * 60 * 1000;
const MAX_RETRY_ATTEMPTS = 2; // Límite para evitar bucles infinitos

export const mainFlow = addKeyword(EVENTS.WELCOME)
    .addAction(async (ctx, { endFlow }) => {
        if (ctx.from !== env.myPhoneNumber) {
            console.log(`🚫 Mensaje ignorado de un número no autorizado: ${ctx.from}`);
            return endFlow();
        }
    })
    .addAction(async (ctx, { state, flowDynamic }) => {
        const lastInteraction = state.get('lastInteraction') || 0;
        const now = Date.now();
        let history = state.get<ChatCompletionMessageParam[]>('history') || [];
        let attempts = state.get('attempts') || 0;

        if (now - lastInteraction > CONVERSATION_EXPIRATION_MS) {
            history = [];
            attempts = 0;
        }

        console.log(`💬 Procesando mensaje: "${ctx.body}"`);
        let aiResponse = await getAIResponse(history, ctx.body);
        let finalResponse = 'Lo siento, ocurrió un error inesperado.';

        if (aiResponse.type === 'tool' && attempts < MAX_RETRY_ATTEMPTS) {
            const { tool, payload } = aiResponse.data;
            
            if (tool === 'run_query_json') {
                console.log(`🤖 La IA decidió usar la herramienta: '${tool}' (Intento #${attempts + 1})`);
                console.log(`📋 Con el siguiente payload:`, JSON.stringify(payload, null, 2));

                const toolResult = await executeSql(payload);

                // --- ¡AQUÍ EMPIEZA EL CICLO DE CORRECCIÓN! ---
                if (toolResult && toolResult.error) {
                    console.log(`❌ La herramienta falló. Devolviendo error a la IA para corrección.`);
                    await state.update({ attempts: attempts + 1 });

                    const contextForCorrection = `La herramienta 'run_query_json' falló.
                    - Tu consulta fue: ${JSON.stringify(payload.input.sql)}
                    - El error devuelto por la base de datos fue: "${toolResult.error}"
                    - Por favor, analiza el error, corrige tu consulta SQL y llama a la herramienta 'run_query_json' de nuevo. NO te disculpes.`;
                    
                    // Hacemos una segunda llamada a la IA con el contexto del error
                    aiResponse = await getAIResponse(
                        [...history, { role: 'user', content: ctx.body }],
                        contextForCorrection
                    );
                    
                    // Si la IA vuelve a decidir usar la herramienta, el flujo se repetirá en el siguiente ciclo.
                    // Si decide responder al usuario, se manejará más abajo.
                } else {
                    // Si la herramienta tuvo éxito, pedimos la interpretación final.
                    console.log('✅ La herramienta tuvo éxito. Pidiendo a la IA que interprete el resultado.');
                    attempts = 0; // Reiniciamos los intentos en caso de éxito

                    const contextForInterpretation = `El sistema ejecutó la consulta SQL con éxito.
                    - Tu consulta fue: ${JSON.stringify(payload.input.sql)}
                    - El resultado fue: ${JSON.stringify(toolResult)}.
                    Ahora, por favor, genera una respuesta final y amigable para el usuario usando 'respond_to_user'.`;
                    
                    const interpretation = await getAIResponse(
                        [...history, { role: 'user', content: ctx.body }],
                        contextForInterpretation
                    );
                    
                    if (interpretation.type === 'tool' && interpretation.data.tool === 'respond_to_user') {
                        finalResponse = interpretation.data.payload.response;
                    } else {
                        finalResponse = "Acción completada con éxito.";
                    }
                }
            }
        }
        
        // Manejo de la respuesta final, ya sea por éxito, corrección o error
        if (aiResponse.type === 'tool' && aiResponse.data.tool === 'respond_to_user') {
            finalResponse = aiResponse.data.payload.response;
        } else if (aiResponse.type === 'text') {
            finalResponse = aiResponse.data;
        } else if (attempts >= MAX_RETRY_ATTEMPTS) {
            finalResponse = "Lo siento, he intentado corregir un error varias veces sin éxito. Por favor, revisa la solicitud o contacta al administrador."
        }
        
        console.log(`➡️  Enviando respuesta final: "${finalResponse}"`);
        const newHistory: ChatCompletionMessageParam[] = [
            ...history,
            { role: 'user', content: ctx.body },
            { role: 'assistant', content: finalResponse }
        ];

        await state.update({ history: newHistory, lastInteraction: now, attempts });
        await flowDynamic(finalResponse);
    });