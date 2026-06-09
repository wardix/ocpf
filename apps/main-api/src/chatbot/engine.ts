import { sql } from '../config/database';
import { redis, PUB_SUB_CH } from '../config/redis';
import type { SendMessagePayload } from '@omnichannel/shared-types';
import { dispatchWebhook } from '../utils/webhooks';

// In-memory cache for chatbot rules per inbox
const chatbotCache = new Map<number, { rules: any; expiresAt: number }>();

export function clearChatbotCache(inboxId: number) {
  chatbotCache.delete(inboxId);
}

export async function getActiveChatbotRules(inboxId: number): Promise<any | null> {
  const now = Date.now();
  const cached = chatbotCache.get(inboxId);
  if (cached && cached.expiresAt > now) {
    return cached.rules;
  }

  try {
    const [activeConfig] = await sql`
      SELECT config FROM chatbot_configs
      WHERE inbox_id = ${inboxId} AND is_active = true LIMIT 1
    `;

    const rules = activeConfig ? activeConfig.config : null;
    chatbotCache.set(inboxId, {
      rules,
      expiresAt: now + 60 * 1000 // 60-second TTL
    });

    return rules;
  } catch (err) {
    console.error(`Failed to get chatbot config for inbox ${inboxId}:`, err);
    return null;
  }
}

export async function evaluateChatbot(
  tx: any,
  ticket: any,
  content: string,
  sourceJid: string,
  displayName: string,
  triggeredGlobalCommand: boolean,
  ACCOUNT_ID: number,
  conversationId: number,
  INBOX_ID: number
) {
  const rules = await getActiveChatbotRules(INBOX_ID);
  if (!rules || !rules.states) return;

  const userText = content.trim();
  let targetNode = null;
  let targetNodeKey = null;

  if (triggeredGlobalCommand) {
    if (rules.global_commands) {
      targetNodeKey = rules.global_commands[userText.toLowerCase()];
    }
    if (targetNodeKey) {
      targetNode = rules.states[targetNodeKey];
    }
  } else {
    const currentState = rules.states[ticket.bot_state];
    if (currentState) {
      if (currentState.options) {
        if (currentState.options[userText]) {
          targetNodeKey = currentState.options[userText];
        } else if (currentState.options['*']) {
          targetNodeKey = currentState.options['*'];
        } else if (currentState.fallback) {
          targetNodeKey = currentState.fallback;
        }
      } else if (currentState.fallback) {
        targetNodeKey = currentState.fallback;
      }
      if (targetNodeKey) targetNode = rules.states[targetNodeKey];
    }
  }

  if (targetNode) {
    let newBotActive = true;
    let memory: Record<string, any> = {};

    const interpolateText = (text: string) => {
      let parsed = text.replace(/{{user_input}}/g, userText);
      parsed = parsed.replace(/{{phone_number}}/g, sourceJid.split('@')[0] || '');
      parsed = parsed.replace(/{{contact_name}}/g, displayName);
      
      const memMatches = parsed.match(/{{([a-zA-Z0-9_.]+?)}}/g);
      if (memMatches) {
        memMatches.forEach(match => {
          const path = match.replace(/[{}]/g, '').split('.');
          let val: any = memory;
          for (const p of path) {
            if (val !== undefined && val !== null) val = val[p];
          }
          if (val !== undefined && typeof val !== 'object') {
            parsed = parsed.replace(match, String(val));
          }
        });
      }
      return parsed;
    };

    const executeStep = async (step: any): Promise<boolean> => {
       if (step.type === 'text' && step.content) {
          const finalBotText = interpolateText(step.content);
          const [botMsg] = await sql`
            INSERT INTO messages (account_id, conversation_id, sender_type, sender_id, content, message_type, status)
            VALUES (${ACCOUNT_ID}, ${conversationId}, 'System', NULL, ${finalBotText}, 'outgoing', 'sent')
            RETURNING *;
          `;
          await redis.publish(PUB_SUB_CH, JSON.stringify({ event: 'message.new', data: botMsg }));
          
          dispatchWebhook(ACCOUNT_ID, 'message.outgoing', botMsg).catch(e => console.error(e));

          const payload: SendMessagePayload = {
            event: 'message.send',
            data: {
              inbox_id: Number(INBOX_ID),
              internal_message_id: Number(botMsg.id),
              target_id: sourceJid,
              content: finalBotText,
              message_type: 'text'
            }
          };
          const targetQueue = `queue:outgoing_messages:inbox_${INBOX_ID}`;
          await redis.rpush(targetQueue, JSON.stringify(payload));
          return true;
       } else if (step.type === 'api_call') {
          try {
            const apiUrl = interpolateText(step.url);
            const reqOptions: any = {
              method: step.method || 'GET',
              headers: step.headers || {}
            };
            
            if (step.body && (step.method === 'POST' || step.method === 'PUT')) {
               const bodyStr = JSON.stringify(step.body);
               reqOptions.body = interpolateText(bodyStr);
               if (!reqOptions.headers['Content-Type']) {
                 reqOptions.headers['Content-Type'] = 'application/json';
               }
            }

            const apiResponse = await fetch(apiUrl, reqOptions);
            const responseData = await apiResponse.json();
            
            if (step.store_response_as) {
              memory[step.store_response_as] = responseData;
            }

            let isSuccess = false;
            if (step.on_success && step.on_success.condition) {
                try {
                  const condition = step.on_success.condition;
                  const match = condition.match(/response\\.([\\w\\.]+)\\s*(===|==|!==|!=|>|<|>=|<=)\\s*(.+)/);

                  if (match) {
                    const [_, path, operator, rawValue] = match;
                    const value = path.split('.').reduce((acc: any, part: string) => acc && acc[part], responseData);

                    let expectedValue: any = rawValue.trim();
                    if ((expectedValue.startsWith("'") && expectedValue.endsWith("'")) || 
                        (expectedValue.startsWith('"') && expectedValue.endsWith('"'))) {
                      expectedValue = expectedValue.slice(1, -1);
                    } else if (!isNaN(Number(expectedValue))) {
                      expectedValue = Number(expectedValue);
                    } else if (expectedValue === 'true') expectedValue = true;
                    else if (expectedValue === 'false') expectedValue = false;
                    else if (expectedValue === 'null') expectedValue = null;

                    switch(operator) {
                      case '==': isSuccess = value == expectedValue; break;
                      case '===': isSuccess = value === expectedValue; break;
                      case '!=': isSuccess = value != expectedValue; break;
                      case '!==': isSuccess = value !== expectedValue; break;
                      case '>': isSuccess = value > expectedValue; break;
                      case '<': isSuccess = value < expectedValue; break;
                      case '>=': isSuccess = value >= expectedValue; break;
                      case '<=': isSuccess = value <= expectedValue; break;
                    }
                  } else {
                    console.warn('Format condition tidak didukung oleh safe evaluator:', condition);
                  }
                } catch (e) {
                  console.error('Condition eval error:', e);
                }
            } else if (apiResponse.ok) {
                isSuccess = true;
            }
            if (isSuccess && step.on_success && step.on_success.target_state) {
                targetNodeKey = step.on_success.target_state;
                return false;
            } else if (!isSuccess && step.on_failure) {
                targetNodeKey = step.on_failure.target_state;
                return false;
            }
            return true;

          } catch (apiErr) {
            console.error('Chatbot API call failed:', apiErr);
            if (step.on_failure) {
                targetNodeKey = step.on_failure.target_state;
                return false;
            }
            return true;
          }
       }
       return true;
    };

    if (targetNode.steps && Array.isArray(targetNode.steps)) {
       for (const step of targetNode.steps) {
          const shouldContinue = await executeStep(step);
          if (!shouldContinue) {
             break;
          }
       }
    } else if (targetNode.text) {
       await executeStep({ type: 'text', content: targetNode.text });
       if (targetNode.api_call) {
         await executeStep({ type: 'api_call', ...targetNode.api_call });
       }
    }

    if (targetNode.action === 'assign_agent') {
      newBotActive = false;
    } else if (targetNodeKey !== ticket.bot_state && rules.states[targetNodeKey]?.action === 'assign_agent') {
      newBotActive = false;
    }

    if (targetNodeKey !== ticket.bot_state || !newBotActive) {
      await sql`
        UPDATE tickets 
        SET bot_state = ${targetNodeKey}, is_bot_active = ${newBotActive}, updated_at = NOW()
        WHERE id = ${ticket.id}
      `;
    }
  }
}
