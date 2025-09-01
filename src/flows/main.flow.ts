import { addKeyword, EVENTS } from '@builderbot/bot';
import { env } from '../config/environment';
import { getAIResponse, AIResponse } from '../services/openrouter.service';
import { executeSql, SessionState } from '../services/mcp.service';
import { ChatCompletionMessageParam } from 'openai/resources';

// --- Constantes de Configuración del Flujo ---

// Tiempo en milisegundos para resetear el historial de la conversación. (30 minutos)
const CONVERSATION_EXPIRATION_MS = 30 * 60 * 1000;

// Número máximo de veces que la IA puede intentar corregir una herramienta fallida.
const MAX_RETRY_ATTEMPTS = 2;

/**
 * Flujo principal que gestiona la conversación con el agente de IA.
 */
export const mainFlow = addKeyword(EVENTS.WELCOME)
    // 1. FILTRO DE SEGURIDAD: Solo responde a un número de teléfono autorizado.
    .addAction(async (ctx, { endFlow }) => {
        if (ctx.from !== env.myPhoneNumber) {
            console.log(`🚫 Mensaje ignorado de un número no autorizado: ${ctx.from}`);
            // endFlow detiene la ejecución del bot para este usuario inmediatamente.
            return endFlow();
        }
    })
    // 2. ACCIÓN PRINCIPAL: Procesa el mensaje del usuario con la IA.
    .addAction(async (ctx, { state, flowDynamic }) => {
        const lastInteraction = state.get<number>('lastInteraction') || 0;
        const now = Date.now();
        let history = state.get<ChatCompletionMessageParam[]>('history') || [];
        let attempts = 0; // El contador de reintentos se reinicia para cada nuevo mensaje.

        // Si ha pasado demasiado tiempo, resetea el historial para empezar una nueva conversación.
        if (now - lastInteraction > CONVERSATION_EXPIRATION_MS) {
            console.log('⌛️ La conversación ha expirado. Reseteando el historial.');
            history = [];
        }

        console.log(`💬 Procesando mensaje de ${ctx.from}: "${ctx.body}"`);
        
        // Primera llamada a la IA con el mensaje del usuario y el historial.
        let aiResponse: AIResponse = await getAIResponse(history, ctx.body);
        
        // Variable para almacenar la respuesta final que se enviará al usuario.
        let finalResponse = 'Lo siento, ocurrió un error inesperado y no pude procesar tu solicitud.';

        // --- BUCLE DE AUTOCORRECCIÓN Y EJECUCIÓN DE HERRAMIENTAS ---
        // Este bucle se ejecuta solo si la IA decide usar la herramienta 'run_query_json'.
        while (
            aiResponse.type === 'tool' &&
            aiResponse.data.tool === 'run_query_json' &&
            attempts < MAX_RETRY_ATTEMPTS
        ) {
            attempts++;
            console.log(`🤖 La IA decidió usar la herramienta 'run_query_json' (Intento #${attempts})`);
            console.log(`📋 Payload:`, JSON.stringify(aiResponse.data.payload, null, 2));

            // ¡Mejora Clave! Pasamos el 'state' a executeSql para gestionar la sesión MCP.
            const toolResult = await executeSql(aiResponse.data.payload, state);

            if (toolResult && toolResult.error) {
                console.log(`❌ La herramienta falló. Error: "${toolResult.error}"`);
                console.log('🧠 Devolviendo el error a la IA para que lo corrija.');
                
                // Construimos un contexto claro para que la IA entienda el error y lo corrija.
                const contextForCorrection = `La herramienta 'run_query_json' falló.
                - Tu consulta SQL fue: ${JSON.stringify(aiResponse.data.payload.sql)}
                - El error devuelto por la base de datos fue: "${toolResult.error}"
                - Por favor, analiza el error, corrige tu consulta SQL y vuelve a llamar a la herramienta 'run_query_json'. NO te disculpes. NO uses respond_to_user.`;
                
                // Volvemos a llamar a la IA con el contexto del error para que genere una nueva consulta.
                aiResponse = await getAIResponse(
                    [...history, { role: 'user', content: ctx.body }],
                    contextForCorrection
                );
                // La siguiente iteración del bucle usará esta nueva respuesta de la IA.

            } else {
                console.log('✅ La herramienta se ejecutó con éxito.');
                console.log('🧠 Pidiendo a la IA que interprete el resultado y responda al usuario.');

                // Construimos un contexto para que la IA genere una respuesta final en lenguaje natural.
                const contextForInterpretation = `La consulta SQL se ejecutó con éxito.
                - Tu consulta fue: ${JSON.stringify(aiResponse.data.payload.sql)}
                - El resultado de la base de datos es: ${JSON.stringify(toolResult)}.
                - Ahora, genera una respuesta final y amigable para el usuario usando la herramienta 'respond_to_user'.`;
                
                aiResponse = await getAIResponse(
                    [...history, { role: 'user', content: ctx.body }],
                    contextForInterpretation
                );
                
                // Salimos del bucle 'while' porque la herramienta fue exitosa.
                break; 
            }
        }

        // --- MANEJO DE LA RESPUESTA FINAL ---
        // Después del bucle, procesamos la respuesta final de la IA.
        if (aiResponse.type === 'tool' && aiResponse.data.tool === 'respond_to_user') {
            // Caso 1: La IA quiere responder directamente al usuario.
            finalResponse = aiResponse.data.payload.response;
        } else if (aiResponse.type === 'text') {
            // Caso 2: La IA respondió con texto simple (un fallback).
            finalResponse = aiResponse.data;
        } else if (attempts >= MAX_RETRY_ATTEMPTS) {
            // Caso 3: Se alcanzó el límite de reintentos, informamos al usuario.
            finalResponse = "Lo siento, he intentado corregir un error varias veces sin éxito. Por favor, revisa la solicitud o contacta al administrador.";
        }
        
        console.log(`➡️  Enviando respuesta final: "${finalResponse}"`);

        // Actualizamos el historial de la conversación en el estado para la próxima interacción.
        const newHistory: ChatCompletionMessageParam[] = [
            ...history,
            { role: 'user', content: ctx.body },
            { role: 'assistant', content: finalResponse }
        ];
        await state.update({ history: newHistory, lastInteraction: now });
        
        // Enviamos el mensaje final al usuario a través de WhatsApp.
        await flowDynamic(finalResponse);
    });