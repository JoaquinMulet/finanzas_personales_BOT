import { addKeyword, EVENTS } from '@builderbot/bot';
import { env } from '../config/environment';
import { getAIResponse, AIResponse } from '../services/openrouter.service';
// ¡Importamos las dos herramientas!
import { executeSql, getSystemContext, SessionState } from '../services/mcp.service';
import { ChatCompletionMessageParam } from 'openai/resources';
// ¡Importamos la nueva función generadora de prompts!
import { generateSystemPrompt } from '../config/system_prompt';

const CONVERSATION_EXPIRATION_MS = 30 * 60 * 1000;
const MAX_RETRY_ATTEMPTS = 5;

export const mainFlow = addKeyword(EVENTS.WELCOME)
    .addAction(async (ctx, { endFlow }) => {
        if (ctx.from !== env.myPhoneNumber) { return endFlow(); }
    })
    .addAction(async (ctx, { state, flowDynamic }) => {
        if (ctx.body.toLowerCase().trim() === 'reset') {
            await state.update({ history: [], mcpSessionUrl: null });
            await flowDynamic("Ok, he reseteado nuestra conversación.");
            return;
        }

        const lastInteraction = state.get<number>('lastInteraction') || 0;
        const now = Date.now();
        let history = state.get<ChatCompletionMessageParam[]>('history') || [];
        if (now - lastInteraction > CONVERSATION_EXPIRATION_MS) { history = []; }

        console.log(`\n💬 [main.flow.ts] Procesando mensaje: "${ctx.body}"`);

        // --- 1. ENRIQUECIMIENTO DE CONTEXTO ---
        console.log("🔄 [main.flow.ts] Obteniendo contexto del sistema (cuentas, categorías, etc.)...");
        const systemContext = await getSystemContext(state as SessionState);
        
        if (systemContext && systemContext.error) {
            console.error("❌ [main.flow.ts] No se pudo obtener el contexto del sistema:", systemContext.error);
            await flowDynamic("Lo siento, tengo problemas para conectarme a mi base de conocimientos en este momento.");
            return;
        }
        
        // --- 2. CONSTRUCCIÓN DEL PROMPT DINÁMICO ---
        const fullSystemPrompt = generateSystemPrompt(systemContext);
        const currentDate = new Date();
        const dynamicSystemPrompt = `Contexto Actual: La fecha y hora de hoy es ${currentDate.toISOString()}.\n\n${fullSystemPrompt}`;

        let messages: ChatCompletionMessageParam[] = [
            { role: 'system', content: dynamicSystemPrompt },
            ...history,
            { role: 'user', content: ctx.body }
        ];
        
        let aiResponse: AIResponse = await getAIResponse(messages);
        let finalResponse = 'Lo siento, ocurrió un error inesperado.';
        let attempts = 0;

        // --- 3. CICLO DE RAZONAMIENTO Y EJECUCIÓN ---
        while (
            aiResponse.type === 'tool' &&
            aiResponse.data.tool === 'run_query_json' &&
            attempts < MAX_RETRY_ATTEMPTS
        ) {
            attempts++;
            const toolResult = await executeSql(aiResponse.data.payload, state as SessionState);
            console.log(`🔍 [main.flow.ts] Resultado de la herramienta:`, toolResult);

            messages.push({ role: 'assistant', content: JSON.stringify(aiResponse.data) });

            let nextUserMessage: string;
            if (toolResult && toolResult.error) {
                nextUserMessage = `La herramienta falló. El error fue: "${toolResult.error}". Analiza el error, corrige tu consulta SQL y llama a la herramienta de nuevo.`;
            } else if (toolResult.data !== undefined) { // Es el resultado de un SELECT
                nextUserMessage = toolResult.data.length === 0 
                    ? `La consulta de búsqueda se completó pero no encontró resultados. Informa al usuario.`
                    : `La consulta de búsqueda tuvo éxito. El resultado es: ${JSON.stringify(toolResult.data)}. Resume esto para el usuario.`;
            } else { // Es el resultado de un INSERT, UPDATE, etc.
                const rowsAffected = toolResult.rows_affected || 0;
                nextUserMessage = `La operación de escritura (INSERT/UPDATE) se completó con éxito, afectando a ${rowsAffected} fila(s). Confirma al usuario que la acción se realizó correctamente.`;
            }
            messages.push({ role: 'user', content: nextUserMessage });
            
            aiResponse = await getAIResponse(messages);
            if(aiResponse.type === 'tool' && aiResponse.data.tool === 'respond_to_user') { break; }
        }

        // --- 4. MANEJO DE RESPUESTA FINAL ---
        if (aiResponse.type === 'tool' && aiResponse.data.tool === 'respond_to_user') {
            finalResponse = aiResponse.data.payload.response;
        } else if (aiResponse.type === 'text') { finalResponse = aiResponse.data; }
        
        const isUselessResponse = !finalResponse || finalResponse.trim() === '' || finalResponse.trim().startsWith('```');
        if (isUselessResponse) {
            finalResponse = "Lo siento, tuve un problema al generar la respuesta. ¿Podrías intentarlo de nuevo?";
        }

        console.log(`➡️  [main.flow.ts] Enviando respuesta final: "${finalResponse}"`);

        const newHistory: ChatCompletionMessageParam[] = [
            ...history, { role: 'user', content: ctx.body }, { role: 'assistant', content: finalResponse }
        ];
        await state.update({ history: newHistory, lastInteraction: now });
        
        await flowDynamic(finalResponse);
    });