// src/services/openrouter.service.ts

import OpenAI from 'openai';
import { env } from '../config/environment';
import { SYSTEM_PROMPT } from '../config/system_prompt';
import { ChatCompletionMessageParam } from 'openai/resources';

/**
 * Interfaz para estandarizar la respuesta que recibimos del servicio de IA.
 * Esto nos permite saber si la IA quiere que ejecutemos una acción (tool)
 * o si simplemente está respondiendo al usuario (text).
 */
export interface AIResponse {
  type: 'text' | 'tool';
  data: any; // Puede ser un string (para text) o un objeto (para tool)
}

/**
 * Cliente de OpenAI configurado para apuntar a la API de OpenRouter.
 */
const openAIClient = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: env.openRouterApiKey,
    defaultHeaders: {
        'HTTP-Referer': 'https://github.com/joaquin-git/fp-agent', // Reemplaza con la URL de tu proyecto
        'X-Title': 'FP-Agent WhatsApp Bot',
    },
});

/**
 * Procesa un mensaje de usuario, junto con el historial de la conversación,
 * y obtiene una respuesta estructurada del LLM a través de OpenRouter.
 *
 * @param history - Un arreglo de los mensajes anteriores en la conversación actual.
 * @param userMessage - El último mensaje enviado por el usuario.
 * @returns Una promesa que resuelve a un objeto `AIResponse`.
 */
export const getAIResponse = async (
    history: ChatCompletionMessageParam[],
    userMessage: string
): Promise<AIResponse> => {

    // --- ¡AQUÍ ESTÁ LA MEJORA CRÍTICA! ---
    // 1. Creamos el pre-prompt dinámico con la fecha y hora actuales.
    const currentDate = new Date();
    const dynamicContext = `Contexto Actual: La fecha y hora de hoy es ${currentDate.toISOString()}. Úsala como referencia para cualquier cálculo de fechas relativas (como "ayer" o "la semana pasada").`;

    // 2. Combinamos el contexto dinámico con el prompt estático.
    const fullSystemPrompt = `${dynamicContext}\n\n${SYSTEM_PROMPT}`;
    
    // 3. Ensamblamos el payload completo para la API con el prompt mejorado.
    const messages: ChatCompletionMessageParam[] = [
        { role: 'system', content: fullSystemPrompt }, // Usamos el prompt completo y contextualizado
        ...history,
        { role: 'user', content: userMessage },
    ];

    try {
        console.log('🤖 Enviando solicitud a OpenRouter con contexto de fecha...');
        const completion = await openAIClient.chat.completions.create({
            model: 'openai/gpt-4o',
            messages: messages,
            response_format: { type: 'json_object' }
        });

        const content = completion.choices[0].message.content;

        if (!content) {
            console.error('Respuesta de la IA vacía.');
            return { type: 'text', data: 'Lo siento, no pude procesar tu solicitud en este momento.' };
        }

        // Intentamos interpretar la respuesta como una llamada a una herramienta
        try {
            const parsedJson = JSON.parse(content);
            if (parsedJson.tool && parsedJson.payload) {
                console.log(`✅ IA respondió con una herramienta: ${parsedJson.tool}`);
                return { type: 'tool', data: parsedJson };
            }
            console.log('📝 IA respondió con JSON, pero no es una herramienta. Tratando como texto.');
            return { type: 'text', data: content };
        } catch (error) {
            console.log('📝 IA respondió con texto plano.');
            return { type: 'text', data: content };
        }

    } catch (error) {
        console.error('❌ Error al comunicarse con la API de OpenRouter:', error);
        return {
            type: 'text',
            data: 'Hubo un problema de conexión con mi cerebro (la IA). Por favor, intenta de nuevo en unos momentos.'
        };
    }
};