import OpenAI from 'openai';
import { env } from '../config/environment';
import { ChatCompletionMessageParam } from 'openai/resources';

// Las interfaces no cambian
interface ToolData { tool: string; payload: any; }
export type AIResponse = | { type: 'text'; data: string } | { type: 'tool'; data: ToolData };

const openAIClient = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: env.openRouterApiKey,
    defaultHeaders: {
        'HTTP-Referer': 'https://github.com/joaquin-git/fp-agent',
        'X-Title': 'FP-Agent WhatsApp Bot',
    },
});

export const getAIResponse = async (
    messages: ChatCompletionMessageParam[]
): Promise<AIResponse> => {
    try {
        console.log('\n--- [openrouter.service.ts] INICIO: CONTEXTO COMPLETO ENVIADO A LA IA ---');
        console.log(JSON.stringify(messages, null, 2));
        console.log('--- [openrouter.service.ts] FIN: CONTEXTO COMPLETO ENVIADO A LA IA ---\n');
        
        const completion = await openAIClient.chat.completions.create({
            model: 'google/gemini-2.5-flash',
            messages,
            response_format: { type: 'json_object' }
        });

        const content = completion.choices[0].message.content;

        console.log('\n--- [openrouter.service.ts] INICIO: RESPUESTA CRUDA RECIBIDA DE LA IA ---');
        console.log(content);
        console.log('--- [openrouter.service.ts] FIN: RESPUESTA CRUDA RECIBIDA DE LA IA ---\n');

        if (!content) {
            return { type: 'text', data: 'Lo siento, no pude procesar tu solicitud.' };
        }
        try {
            const parsedJson = JSON.parse(content);
            if (parsedJson.tool_name && parsedJson.arguments) {
                return { type: 'tool', data: { tool: parsedJson.tool_name, payload: parsedJson.arguments }};
            }
            return { type: 'text', data: content };
        } catch (error) {
            return { type: 'text', data: content };
        }
    } catch (error) {
        console.error('❌ [openrouter.service.ts] Error al comunicarse con la API de OpenRouter:', error);
        return { type: 'text', data: 'Hubo un problema de conexión con mi cerebro (la IA).' };
    }
};